/**
 * Copia el estado de los MEDIOS (fotos y vídeos) de una base de datos a otra.
 *
 * PARA QUÉ EXISTE
 * Las fotos viven en el bucket de GCS; Mongo solo guarda la referencia (la URL y, en los campos
 * que lo admiten, el juego completo de `ImageAssetType`: `storageKey`, `storagePrefix`, medidas y
 * `variants[]`). Si una tanda de subidas se hizo con el backend apuntando a la base equivocada,
 * los ARCHIVOS ya están en el bucket y son los mismos para todos: lo único que falta en la otra
 * base son esas referencias. Este script las copia, y solo esas: no vuelve a subir un byte.
 *
 * POR QUÉ NO ES UN `mongodump`/`mongorestore` NI UN COPIADO DE DOCUMENTOS COMPLETO
 * Las dos bases no son copias la una de la otra: cada una puede tener textos, precios, orden o
 * traducciones editados por su lado. Copiar el documento entero pisaría ese trabajo. Por eso el
 * modo por defecto (`--mode media`) recorre el documento y escribe ÚNICAMENTE las ubicaciones
 * donde hay una URL de medio, dejando intacto todo lo demás del mismo documento. `--mode full-doc`
 * existe para el caso contrario (el destino no tiene nada que conservar) y hay que pedirlo a mano.
 *
 * SEGURIDAD DE LA CORRIDA
 *   - No escribe nada sin `--apply`: sin esa bandera imprime el plan y termina.
 *   - Antes de cada escritura guarda el valor anterior de los campos que toca en
 *     `respaldos/media-sync-<fecha>.json`, y ese mismo archivo se le pasa a `--rollback` para
 *     deshacer la corrida.
 *   - Nunca borra documentos. Los que solo existen en el origen se reportan y se saltan, salvo que
 *     se pida `--insert-missing`.
 *
 * USO
 *   # 1. ver qué haría (no escribe nada)
 *   npx ts-node src/scripts/syncMediaToDb.ts --target "<URI de la base destino>"
 *
 *   # 2. aplicarlo de verdad
 *   npx ts-node src/scripts/syncMediaToDb.ts --target "<URI destino>" --apply
 *
 *   # 3. deshacerlo, si hizo falta
 *   npx ts-node src/scripts/syncMediaToDb.ts --target "<URI destino>" --rollback respaldos/media-sync-....json
 *
 * BANDERAS
 *   --source <uri>        Base de ORIGEN (de donde salen las fotos buenas). Default: DATABASE_URL del .env.
 *   --target <uri>        Base de DESTINO. Obligatoria. También se puede poner en `DATABASE_URL_TARGET`.
 *   --apply               Escribe. Sin esto es simulacro.
 *   --mode media|full-doc `media` (default) solo toca las ubicaciones con URL; `full-doc` reemplaza
 *                         el documento entero del destino por el del origen.
 *   --collections a,b     Limita las colecciones (default: las del CMS, ver COLECCIONES).
 *   --solo-agregar        El destino no pierde NADA: las galerías se unen en vez de reemplazarse y
 *                         una foto que el destino ya tiene no se pisa (se reporta). Es el modo a usar
 *                         cuando el destino es producción y solo faltan ahí las fotos nuevas.
 *   --insert-missing      Inserta en el destino los documentos que solo existen en el origen.
 *   --check-urls          Antes de escribir, un HEAD a cada URL nueva para confirmar que el archivo
 *                         está en el bucket. Aborta si alguna falla (salvo `--force`).
 *   --force               Aplica aunque `--check-urls` encuentre URLs rotas.
 *   --verbose             Lista cambio por cambio en vez de resumir por documento.
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId, type Collection, type Document } from "mongodb";
// EJSON viene con el driver (`bson` es su dependencia). Se usa para el archivo de respaldo: un
// `JSON.stringify` normal convertiría los `ObjectId` y las fechas del valor anterior en texto, y el
// `--rollback` volvería a escribirlos como texto, cambiando el tipo del campo sin avisar.
import { EJSON } from "bson";

dotenv.config();

// ── Configuración ────────────────────────────────────────────────────────────────────────────────

/**
 * Colecciones del CMS de la web. Es una lista explícita y no "todas las colecciones" a propósito:
 * el clúster comparte base con la app de gestión (200+ colecciones con consumos, reservas y
 * comprobantes) y nada de eso es trabajo de este script.
 */
const COLECCIONES = [
  "areas",
  "extras",
  "roomtypelocalspecs",
  "landingmedias",
  "beneficios",
  "condominios",
  "fulldays",
  "retiros",
];

/**
 * Cómo emparejar un documento del origen con el del destino cuando los `_id` no coinciden (una
 * base recreada desde cero tiene otros ObjectId). Se intenta primero por `_id`; esto es el respaldo.
 */
const CLAVES_NATURALES: Record<string, string[]> = {
  areas: ["nombre"],
  extras: ["nombre"],
  beneficios: ["nombre"],
  condominios: ["name"],
  fulldays: ["nombre"],
  retiros: ["nombre"],
  landingmedias: ["tipo", "nombre", "sectionId"],
  roomtypelocalspecs: ["roomTypeID"],
};

/**
 * Claves que forman parte de una referencia de medio y que viajan JUNTO a la URL. Sin ellas el
 * front no puede armar el `srcset` (`variants`, `width`, `height`) ni el backend borrar la imagen
 * (`storagePrefix`, `storageKey`), así que copiar solo la URL dejaría la foto a medias.
 */
const CLAVES_DE_MEDIO = new Set([
  "url",
  "src",
  "storageKey",
  "storagePrefix",
  "width",
  "height",
  "format",
  "variants",
  "legacyUrl",
  "legacyStorageKey",
  "kind",
  "status",
]);

/**
 * Campos que no contienen una URL pero que solo tienen sentido junto a la foto que acompañan: el
 * id del archivo del ícono y el encuadre de las portadas. Si se copian las fotos sin esto, el
 * destino queda con el encuadre de la foto vieja.
 */
const CAMPOS_ACOMPANANTES: Record<string, string[]> = {
  beneficios: ["iconFileId"],
  roomtypelocalspecs: ["posicion_fotos_portadas"],
};

/** Claves de control de Mongo/Mongoose: nunca se copian de una base a otra. */
const CLAVES_IGNORADAS = new Set(["_id", "__v", "createdAt", "updatedAt"]);

const EXTENSION_DE_MEDIO = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif|mp4|webm|mov|m4v)(\?|$)/i;

/**
 * ¿Este string es una referencia a un medio?
 *
 * Se aceptan las URL de `storage.googleapis.com` con o sin extensión reconocible (los buckets
 * `greendreams_bucket` y `marketing_gallery`, que es donde está todo lo subido por el CMS) y
 * cualquier otra URL http(s) que termine en extensión de imagen o vídeo: así también se sincronizan
 * las referencias antiguas que quedaron en Cloudinary o Supabase, que de otro modo el script
 * ignoraría y dejaría desparejas entre las dos bases.
 */
export const esUrlDeMedio = (valor: unknown): valor is string => {
  if (typeof valor !== "string") return false;
  const url = valor.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  return url.includes("storage.googleapis.com/") || EXTENSION_DE_MEDIO.test(url);
};

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────

const esObjetoPlano = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" &&
  valor !== null &&
  !Array.isArray(valor) &&
  !(valor instanceof Date) &&
  // ObjectId, Binary y demás tipos BSON llevan `_bsontype`: son valores, no ramas que recorrer.
  (valor as { _bsontype?: unknown })._bsontype === undefined;

/** Comparación estructural. Los tipos BSON y las fechas se comparan por su representación. */
const sonIguales = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return String(a) === String(b);
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if ((a as { _bsontype?: unknown })._bsontype || (b as { _bsontype?: unknown })._bsontype) {
    return String(a) === String(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sonIguales(item, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sonIguales((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/** ¿Hay alguna URL de medio en algún punto de este valor? Decide si una rama se toca o se deja. */
const contieneMedio = (valor: unknown, profundidad = 0): boolean => {
  if (profundidad > 24) return false;
  if (esUrlDeMedio(valor)) return true;
  if (Array.isArray(valor)) return valor.some((item) => contieneMedio(item, profundidad + 1));
  if (esObjetoPlano(valor)) {
    return Object.entries(valor).some(([clave, item]) =>
      CLAVES_IGNORADAS.has(clave) ? false : contieneMedio(item, profundidad + 1)
    );
  }
  return false;
};

/** Un objeto que ES la referencia en sí (`{ url, variants, ... }` o la hoja `{ src, kind }`). */
const esNodoDeMedio = (valor: unknown): valor is Record<string, unknown> =>
  esObjetoPlano(valor) && (esUrlDeMedio(valor.url) || esUrlDeMedio(valor.src));

/**
 * Nombre legible del documento para el reporte. Varios modelos guardan el nombre traducido
 * (`{ es, en }`), que con un `String()` directo sale como `[object Object]` y deja el reporte
 * inservible justo cuando hay que revisarlo documento por documento.
 */
const etiquetaDe = (doc: Document): string => {
  const nombre = doc.nombre ?? doc.name ?? doc.roomTypeName;
  if (esObjetoPlano(nombre)) return String(nombre.es ?? nombre.en ?? Object.values(nombre)[0] ?? doc._id);
  if (typeof nombre === "string" && nombre.trim()) return nombre;
  return String(doc.roomTypeID ?? doc._id);
};

/** Un array de fotos: sus elementos son la referencia (string suelto u objeto-asset). */
const esArrayDeMedios = (valor: unknown): valor is unknown[] =>
  Array.isArray(valor) && valor.some((item) => esUrlDeMedio(item) || esNodoDeMedio(item));

const ocultarClave = (uri: string): string => uri.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");

const recortar = (valor: unknown, largo = 90): string => {
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  if (texto === undefined) return "undefined";
  return texto.length > largo ? `${texto.slice(0, largo - 3)}...` : texto;
};

// ── El plan de una colección ─────────────────────────────────────────────────────────────────────

type Cambio = { path: string; de: unknown; a: unknown };
type Salto = { path: string; motivo: string };
/** Una foto del origen que en modo `--solo-agregar` NO se escribió porque el destino ya tenía otra. */
type Omision = { path: string; conserva: unknown; ignora: unknown };

type PlanDoc = {
  coleccion: string;
  /** `_id` del documento en el DESTINO (el que se va a escribir), o null si es una inserción. */
  idDestino: string | null;
  /**
   * El `_id` tal cual vino del destino. Se filtra con ESTE valor y no con uno reconstruido desde el
   * string: no todas las colecciones usan `ObjectId` como `_id`, y un filtro con el tipo equivocado
   * no falla, simplemente no encuentra nada y la actualización se pierde en silencio.
   */
  idDestinoRaw?: unknown;
  idOrigen: string;
  etiqueta: string;
  emparejadoPor: "_id" | "clave-natural" | "nuevo";
  cambios: Cambio[];
  saltos: Salto[];
  omisiones: Omision[];
  /** Solo las claves de primer nivel que cambian, con su valor nuevo: es el `$set` que se manda. */
  set: Record<string, unknown>;
  /** El valor anterior de esas mismas claves, para el respaldo y el `--rollback`. */
  anterior: Record<string, unknown>;
  /** El documento entero del origen, cuando hay que insertarlo. */
  docOrigen?: Document;
};

type ContextoFusion = {
  cambios: Cambio[];
  saltos: Salto[];
  omisiones: Omision[];
  /**
   * Modo `--solo-agregar`: el destino no pierde NADA. Las galerías se unen en vez de reemplazarse,
   * una foto que el destino ya tiene en un campo suelto no se pisa (se anota como omisión), y no se
   * borra ninguna clave. Es el modo correcto cuando el destino es producción y lo único que falta
   * ahí son las fotos nuevas: sin esto, una galería más corta en el origen BORRARÍA fotos buenas.
   */
  soloAgregar: boolean;
};

/**
 * Identidad de una foto, para unir dos galerías sin duplicar y para decidir si dos referencias son
 * "la misma foto".
 *
 * Manda la URL, no `storageKey`, aunque `storageKey` parezca la clave más fiable: si los dos no
 * concuerdan (pasa cuando alguien editó la URL a mano y la marca quedó vieja), lo que el visitante
 * ve es la URL. Con `storageKey` como clave, dos fotos distintas se tomarían por una sola y en
 * `--solo-agregar` la del destino se sobrescribiría: justo lo que ese modo promete no hacer.
 */
const identidadDeMedio = (valor: unknown): string => {
  if (esUrlDeMedio(valor)) return valor.trim().split("?")[0];
  if (esObjetoPlano(valor)) {
    const url = typeof valor.url === "string" ? valor.url : typeof valor.src === "string" ? valor.src : "";
    if (url) return url.trim().split("?")[0];
    const clave = valor.storageKey ?? valor.storagePrefix;
    if (typeof clave === "string" && clave) return clave;
  }
  return JSON.stringify(valor);
};

/** Una línea del archivo de respaldo: lo justo para poder deshacer esa escritura. */
type RegistroAplicado = {
  coleccion: string;
  /** El `_id` del destino con su tipo BSON original (por eso el archivo se serializa con EJSON). */
  idDestino: unknown;
  etiqueta: string;
  /** Valor que tenían en el destino las claves de primer nivel que se escribieron. */
  anterior: Record<string, unknown>;
  /** `true` si la corrida CREÓ el documento: deshacerlo es borrarlo, no restaurar nada. */
  insertado?: boolean;
};

/**
 * Devuelve el valor que debe quedar en el destino para esta rama, copiando del origen SOLO las
 * ubicaciones con medios y conservando del destino todo lo demás.
 *
 * La regla de los arrays merece explicación: un array de fotos (`imagenes[]`, `photos[]`,
 * `variants[]`) se copia ENTERO, porque su orden y su longitud son parte del dato — si el origen
 * tiene 5 fotos y el destino 7, mezclar por índice dejaría dos fotos viejas colgando al final. Un
 * array cuyos elementos no son fotos pero las contienen (`bedrooms[]`, que lleva descripción y
 * fotos) se recorre elemento a elemento, para no pisar la descripción; si el destino no tiene ese
 * elemento, se reporta como salto en vez de inventar un dormitorio a medias.
 */
export function fusionarMedios(origen: unknown, destino: unknown, ruta: string, ctx: ContextoFusion): unknown {
  if (esArrayDeMedios(origen)) {
    if (!ctx.soloAgregar) {
      if (!sonIguales(origen, destino)) ctx.cambios.push({ path: ruta, de: destino, a: origen });
      return origen;
    }

    // Unión: primero lo que el destino ya tiene (en su orden), y al final las fotos del origen que
    // no estén. Una foto repetida se enriquece con la versión del origen —que trae `variants` y
    // medidas— pero no se mueve de sitio ni se descarta ninguna del destino.
    const previas = Array.isArray(destino) ? destino : [];
    const porIdentidad = new Map(origen.map((item) => [identidadDeMedio(item), item]));
    const salida = previas.map((item) => {
      const mejor = porIdentidad.get(identidadDeMedio(item));
      return mejor === undefined ? item : mejor;
    });
    const yaEstan = new Set(previas.map(identidadDeMedio));
    const agregadas = origen.filter((item) => !yaEstan.has(identidadDeMedio(item)));
    salida.push(...agregadas);

    if (!sonIguales(salida, destino)) {
      ctx.cambios.push({ path: ruta, de: destino, a: salida });
    }
    return salida;
  }

  if (Array.isArray(origen)) {
    if (!Array.isArray(destino)) {
      if (destino === undefined || destino === null) {
        ctx.cambios.push({ path: ruta, de: destino, a: origen });
        return origen;
      }
      ctx.saltos.push({ path: ruta, motivo: "en el destino esa ubicación no es un array" });
      return destino;
    }
    const salida = destino.slice();
    origen.forEach((item, i) => {
      if (!contieneMedio(item)) return;
      if (i >= destino.length) {
        ctx.saltos.push({ path: `${ruta}.${i}`, motivo: "el destino no tiene ese elemento del array" });
        return;
      }
      salida[i] = fusionarMedios(item, destino[i], `${ruta}.${i}`, ctx);
    });
    return salida;
  }

  if (esObjetoPlano(origen)) {
    if (destino === undefined || destino === null) {
      ctx.cambios.push({ path: ruta, de: destino, a: origen });
      return origen;
    }
    if (!esObjetoPlano(destino)) {
      ctx.saltos.push({ path: ruta, motivo: "en el destino esa ubicación no es un objeto" });
      return destino;
    }

    const nodo = esNodoDeMedio(origen);

    // En `--solo-agregar`, una ubicación que ya tiene SU foto en el destino no se toca: cambiarla
    // sería quitar la que está puesta. Solo se anota para que quede en el reporte.
    if (ctx.soloAgregar && nodo && esNodoDeMedio(destino) && identidadDeMedio(origen) !== identidadDeMedio(destino)) {
      ctx.omisiones.push({ path: ruta, conserva: destino.url ?? destino.src, ignora: origen.url ?? origen.src });
      return destino;
    }

    const salida: Record<string, unknown> = { ...destino };

    for (const [clave, valor] of Object.entries(origen)) {
      if (CLAVES_IGNORADAS.has(clave)) continue;

      if (nodo && CLAVES_DE_MEDIO.has(clave)) {
        if (!sonIguales(valor, destino[clave])) {
          ctx.cambios.push({ path: ruta ? `${ruta}.${clave}` : clave, de: destino[clave], a: valor });
        }
        salida[clave] = valor;
        continue;
      }


      if (!contieneMedio(valor)) continue;
      salida[clave] = fusionarMedios(valor, destino[clave], ruta ? `${ruta}.${clave}` : clave, ctx);
    }

    // Si el destino conserva marcas del pipeline que el origen ya no tiene (p. ej. `legacyUrl` de
    // una imagen que se volvió a subir), quedarían apuntando a un archivo que no corresponde a esta
    // foto: se borran para que la referencia quede exactamente como en el origen.
    if (nodo && !ctx.soloAgregar) {
      for (const clave of Object.keys(destino)) {
        if (!CLAVES_DE_MEDIO.has(clave) || clave in origen) continue;
        ctx.cambios.push({ path: ruta ? `${ruta}.${clave}` : clave, de: destino[clave], a: undefined });
        delete salida[clave];
      }
    }

    return salida;
  }

  if (esUrlDeMedio(origen)) {
    if (ctx.soloAgregar && esUrlDeMedio(destino) && identidadDeMedio(origen) !== identidadDeMedio(destino)) {
      ctx.omisiones.push({ path: ruta, conserva: destino, ignora: origen });
      return destino;
    }
    if (!sonIguales(origen, destino)) ctx.cambios.push({ path: ruta, de: destino, a: origen });
    return origen;
  }

  return destino;
}

/** Arma el plan de un documento ya emparejado. */
export function planificarDoc(
  coleccion: string,
  docOrigen: Document,
  docDestino: Document,
  emparejadoPor: PlanDoc["emparejadoPor"],
  modo: "media" | "full-doc",
  soloAgregar = false
): PlanDoc {
  const etiqueta = etiquetaDe(docOrigen);
  const plan: PlanDoc = {
    coleccion,
    idDestino: String(docDestino._id),
    idDestinoRaw: docDestino._id,
    idOrigen: String(docOrigen._id),
    etiqueta,
    emparejadoPor,
    cambios: [],
    saltos: [],
    omisiones: [],
    set: {},
    anterior: {},
  };

  if (modo === "full-doc") {
    for (const [clave, valor] of Object.entries(docOrigen)) {
      if (CLAVES_IGNORADAS.has(clave)) continue;
      if (sonIguales(valor, docDestino[clave])) continue;
      plan.cambios.push({ path: clave, de: docDestino[clave], a: valor });
      plan.set[clave] = valor;
      plan.anterior[clave] = docDestino[clave];
    }
    return plan;
  }

  const ctx: ContextoFusion = { cambios: [], saltos: [], omisiones: [], soloAgregar };
  const acompanantes = new Set(CAMPOS_ACOMPANANTES[coleccion] ?? []);

  for (const [clave, valor] of Object.entries(docOrigen)) {
    if (CLAVES_IGNORADAS.has(clave)) continue;

    const esAcompanante = acompanantes.has(clave);
    if (!esAcompanante && !contieneMedio(valor)) continue;

    // Un campo acompañante (el encuadre de la portada, el id del ícono) solo tiene sentido junto a
    // SU foto: si en modo `--solo-agregar` la foto del destino se conserva, su encuadre también.
    if (esAcompanante && soloAgregar && docDestino[clave] !== undefined && docDestino[clave] !== null) continue;

    const nuevo = esAcompanante ? valor : fusionarMedios(valor, docDestino[clave], clave, ctx);
    if (sonIguales(nuevo, docDestino[clave])) continue;

    if (esAcompanante) ctx.cambios.push({ path: clave, de: docDestino[clave], a: valor });
    plan.set[clave] = nuevo;
    plan.anterior[clave] = docDestino[clave];
  }

  plan.cambios = ctx.cambios;
  plan.saltos = ctx.saltos;
  plan.omisiones = ctx.omisiones;
  return plan;
}

/** Índice del destino por `_id` y por clave natural, para emparejar sin un `find` por documento. */
function indexar(docs: Document[], claves: string[]) {
  const porId = new Map<string, Document>();
  const porClave = new Map<string, Document>();
  for (const doc of docs) {
    porId.set(String(doc._id), doc);
    if (claves.length) {
      const valor = claves.map((c) => String(doc[c] ?? "")).join("|");
      // Una clave natural repetida no sirve para emparejar: se descarta para no escribirle al
      // documento equivocado. El emparejamiento por `_id` sigue funcionando igual.
      if (porClave.has(valor)) porClave.set(valor, null as unknown as Document);
      else porClave.set(valor, doc);
    }
  }
  return { porId, porClave };
}

// ── Comprobación de que los archivos existen ─────────────────────────────────────────────────────

async function comprobarUrls(urls: string[], concurrencia = 8): Promise<string[]> {
  const rotas: string[] = [];
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < urls.length) {
      const url = urls[siguiente++];
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (!res.ok) rotas.push(`${res.status} ${url}`);
      } catch (error) {
        rotas.push(`ERR ${url} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, urls.length) }, trabajador));
  return rotas;
}

/** Todas las URL nuevas que el plan va a dejar escritas, sin repetir. */
function urlsNuevas(planes: PlanDoc[]): string[] {
  const urls = new Set<string>();
  const visitar = (valor: unknown, profundidad = 0): void => {
    if (profundidad > 24) return;
    if (esUrlDeMedio(valor)) urls.add(valor.trim());
    else if (Array.isArray(valor)) valor.forEach((v) => visitar(v, profundidad + 1));
    else if (esObjetoPlano(valor)) Object.values(valor).forEach((v) => visitar(v, profundidad + 1));
  };
  for (const plan of planes) for (const cambio of plan.cambios) visitar(cambio.a);
  return [...urls];
}

// ── Argumentos ───────────────────────────────────────────────────────────────────────────────────

function leerArgs(argv: string[]) {
  const valor = (nombre: string): string | undefined => {
    const i = argv.indexOf(nombre);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const bandera = (nombre: string): boolean => argv.includes(nombre);

  const modo = (valor("--mode") ?? "media") as "media" | "full-doc";
  if (modo !== "media" && modo !== "full-doc") {
    throw new Error(`--mode solo acepta "media" o "full-doc" (recibido: ${modo})`);
  }

  return {
    source: (valor("--source") ?? process.env.DATABASE_URL ?? "").trim(),
    target: (valor("--target") ?? process.env.DATABASE_URL_TARGET ?? "").trim(),
    apply: bandera("--apply"),
    modo,
    colecciones: (valor("--collections")?.split(",").map((c) => c.trim()).filter(Boolean) ?? COLECCIONES),
    soloAgregar: bandera("--solo-agregar"),
    insertMissing: bandera("--insert-missing"),
    checkUrls: bandera("--check-urls"),
    force: bandera("--force"),
    verbose: bandera("--verbose"),
    rollback: valor("--rollback"),
  };
}

/** El nombre de base que trae la URI; sin él, el driver usaría `test` sin avisar. */
function nombreDeBase(uri: string): string {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  const nombre = match?.[1]?.trim();
  if (!nombre) throw new Error(`La URI no incluye el nombre de la base de datos: ${ocultarClave(uri)}`);
  return decodeURIComponent(nombre);
}

// ── Rollback ─────────────────────────────────────────────────────────────────────────────────────

async function deshacer(archivo: string, uriDestino: string) {
  const reporte = EJSON.parse(fs.readFileSync(archivo, "utf8")) as unknown as {
    target: string;
    aplicados: RegistroAplicado[];
  };

  const cliente = new MongoClient(uriDestino, { serverSelectionTimeoutMS: 20_000 });
  await cliente.connect();
  const db = cliente.db(nombreDeBase(uriDestino));

  let revertidos = 0;
  let insertados = 0;
  for (const registro of reporte.aplicados) {
    const col: Collection = db.collection(registro.coleccion);
    const filtro = { _id: registro.idDestino as ObjectId };
    if (registro.insertado) {
      // Lo que insertó la corrida no existía antes: deshacer es borrarlo.
      await col.deleteOne(filtro);
      insertados += 1;
      continue;
    }
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    for (const [clave, valor] of Object.entries(registro.anterior)) {
      if (valor === undefined || valor === null) unset[clave] = "";
      else set[clave] = valor;
    }
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) await col.updateOne(filtro, update);
    revertidos += 1;
  }

  await cliente.close();
  console.log(`Revertidos ${revertidos} documentos y borrados ${insertados} insertados por la corrida.`);
}

// ── Principal ────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = leerArgs(process.argv.slice(2));

  if (!args.target) {
    throw new Error(
      "Falta la base de DESTINO: pásala con --target \"<uri>\" o ponla en DATABASE_URL_TARGET del .env."
    );
  }
  if (args.rollback) {
    await deshacer(args.rollback, args.target);
    return;
  }
  if (!args.source) throw new Error("Falta la base de ORIGEN: --source \"<uri>\" o DATABASE_URL en el .env.");

  if (args.soloAgregar && args.modo === "full-doc") {
    throw new Error("--solo-agregar y --mode full-doc se contradicen: full-doc reemplaza el documento entero.");
  }

  const baseOrigen = nombreDeBase(args.source);
  const baseDestino = nombreDeBase(args.target);
  if (args.source === args.target) {
    throw new Error("El origen y el destino son la MISMA URI: no hay nada que copiar.");
  }

  console.log(`\nOrigen  : ${ocultarClave(args.source)}`);
  console.log(`Destino : ${ocultarClave(args.target)}`);
  console.log(
    `Modo    : ${args.modo}${args.soloAgregar ? " + solo-agregar (el destino no pierde ninguna foto)" : ""}` +
      `${args.apply ? "" : "   (SIMULACRO — no escribe nada)"}`
  );

  const clienteOrigen = new MongoClient(args.source, { serverSelectionTimeoutMS: 20_000 });
  const clienteDestino = new MongoClient(args.target, { serverSelectionTimeoutMS: 20_000 });
  await Promise.all([clienteOrigen.connect(), clienteDestino.connect()]);
  const dbOrigen = clienteOrigen.db(baseOrigen);
  const dbDestino = clienteDestino.db(baseDestino);

  // Que las dos URIs apunten al mismo sitio es justamente el error que motivó este script: si el
  // clúster y la base coinciden, copiar sería escribirle al origen.
  const idOrigen = await dbOrigen.admin().command({ hello: 1 });
  const idDestino = await dbDestino.admin().command({ hello: 1 });
  if (baseOrigen === baseDestino && String(idOrigen.setName) === String(idDestino.setName) && idOrigen.me === idDestino.me) {
    await Promise.all([clienteOrigen.close(), clienteDestino.close()]);
    throw new Error(
      `Origen y destino son la misma base (${baseOrigen} en ${idOrigen.setName}). Revisa las URIs: ` +
        "distinto usuario no significa distinta base."
    );
  }

  const existentesDestino = new Set((await dbDestino.listCollections().toArray()).map((c) => c.name));
  const planes: PlanDoc[] = [];
  const faltantes: PlanDoc[] = [];
  const coleccionesAusentes: string[] = [];

  for (const coleccion of args.colecciones) {
    const docsOrigen = await dbOrigen.collection(coleccion).find({}).toArray();
    if (!docsOrigen.length) continue;
    if (!existentesDestino.has(coleccion)) {
      coleccionesAusentes.push(coleccion);
      if (!args.insertMissing) continue;
    }

    const docsDestino = existentesDestino.has(coleccion)
      ? await dbDestino.collection(coleccion).find({}).toArray()
      : [];
    const claves = CLAVES_NATURALES[coleccion] ?? [];
    const { porId, porClave } = indexar(docsDestino, claves);

    for (const docOrigen of docsOrigen) {
      let docDestino = porId.get(String(docOrigen._id));
      let emparejadoPor: PlanDoc["emparejadoPor"] = "_id";

      if (!docDestino && claves.length) {
        const valor = claves.map((c) => String(docOrigen[c] ?? "")).join("|");
        const candidato = porClave.get(valor);
        if (candidato) {
          docDestino = candidato;
          emparejadoPor = "clave-natural";
        }
      }

      if (!docDestino) {
        faltantes.push({
          coleccion,
          idDestino: null,
          idOrigen: String(docOrigen._id),
          etiqueta: etiquetaDe(docOrigen),
          emparejadoPor: "nuevo",
          cambios: [{ path: "(documento completo)", de: undefined, a: "nuevo en el destino" }],
          saltos: [],
          omisiones: [],
          set: {},
          anterior: {},
          docOrigen,
        });
        continue;
      }

      const plan = planificarDoc(coleccion, docOrigen, docDestino, emparejadoPor, args.modo, args.soloAgregar);
      if (plan.cambios.length || plan.saltos.length || plan.omisiones.length) planes.push(plan);
    }
  }

  // ── Reporte ──
  if (coleccionesAusentes.length) {
    console.log(`\nColecciones que no existen en el destino: ${coleccionesAusentes.join(", ")}`);
  }

  const conCambios = planes.filter((p) => p.cambios.length);
  console.log("\n── Documentos a actualizar ──────────────────────────────────────────────────────");
  if (!conCambios.length) console.log("  (ninguno: el destino ya tiene los mismos medios)");
  for (const plan of conCambios) {
    const marca = plan.emparejadoPor === "clave-natural" ? " [emparejado por nombre, no por _id]" : "";
    console.log(`  ${plan.coleccion}/${plan.etiqueta}  ${plan.cambios.length} cambio(s)${marca}`);
    if (args.verbose) {
      for (const cambio of plan.cambios) {
        console.log(`      ${cambio.path}`);
        console.log(`        antes: ${recortar(cambio.de)}`);
        console.log(`        ahora: ${recortar(cambio.a)}`);
      }
    }
  }

  const saltos = planes.flatMap((p) => p.saltos.map((s) => ({ ...s, doc: `${p.coleccion}/${p.etiqueta}` })));
  if (saltos.length) {
    console.log("\n── Ubicaciones saltadas (estructura distinta entre las dos bases) ───────────────");
    for (const salto of saltos) console.log(`  ${salto.doc}  ${salto.path}: ${salto.motivo}`);
  }

  const omisiones = planes.flatMap((p) => p.omisiones.map((o) => ({ ...o, doc: `${p.coleccion}/${p.etiqueta}` })));
  if (omisiones.length) {
    console.log("\n── Fotos del origen NO copiadas: el destino ya tiene otra ahí ───────────────────");
    for (const om of omisiones) {
      console.log(`  ${om.doc}  ${om.path}`);
      console.log(`      conserva: ${recortar(om.conserva)}`);
      console.log(`      ignora  : ${recortar(om.ignora)}`);
    }
  }

  if (faltantes.length) {
    console.log(
      `\n── Solo existen en el origen (${faltantes.length}) ${
        args.insertMissing ? "— se van a INSERTAR" : "— se saltan; usa --insert-missing para crearlos"
      } ──`
    );
    for (const plan of faltantes) console.log(`  ${plan.coleccion}/${plan.etiqueta}`);
  }

  const totalCambios = conCambios.reduce((n, p) => n + p.cambios.length, 0);
  console.log(
    `\nResumen: ${conCambios.length} documento(s) con ${totalCambios} cambio(s); ` +
      `${faltantes.length} solo en el origen; ${saltos.length} ubicación(es) saltada(s); ` +
      `${omisiones.length} foto(s) no copiada(s) por no pisar la del destino.`
  );

  // ── Comprobación de archivos ──
  if (args.checkUrls && (conCambios.length || (args.insertMissing && faltantes.length))) {
    const urls = urlsNuevas([...conCambios, ...(args.insertMissing ? faltantes : [])]);
    console.log(`\nComprobando ${urls.length} URL(s) en el bucket...`);
    const rotas = await comprobarUrls(urls);
    if (rotas.length) {
      console.log(`  ${rotas.length} URL(s) NO responden:`);
      for (const rota of rotas.slice(0, 20)) console.log(`    ${rota}`);
      if (!args.force) {
        await Promise.all([clienteOrigen.close(), clienteDestino.close()]);
        throw new Error("Hay URLs que no existen en el bucket. Revisa antes de escribir, o usa --force.");
      }
    } else {
      console.log("  Todas responden.");
    }
  }

  if (!args.apply) {
    console.log("\nSimulacro: no se escribió nada. Repite el comando con --apply para aplicarlo.");
    await Promise.all([clienteOrigen.close(), clienteDestino.close()]);
    return;
  }

  // ── Escritura ──
  const aplicados: RegistroAplicado[] = [];

  const carpeta = path.resolve(process.cwd(), "respaldos");
  fs.mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, `media-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const guardarRespaldo = () =>
    fs.writeFileSync(
      archivo,
      EJSON.stringify(
        {
          fecha: new Date().toISOString(),
          source: ocultarClave(args.source),
          target: ocultarClave(args.target),
          modo: args.modo,
          aplicados,
        },
        undefined,
        2,
        { relaxed: true }
      )
    );

  // El respaldo se escribe ANTES de tocar la base y con TODOS los valores anteriores, no al final:
  // si la corrida se corta a la mitad (red, permisos, Ctrl-C), lo que ya se escribió tiene que
  // seguir siendo reversible. Revertir un documento que no llegó a cambiar lo deja como estaba.
  for (const plan of conCambios) {
    if (!Object.keys(plan.set).length) continue;
    aplicados.push({
      coleccion: plan.coleccion,
      idDestino: plan.idDestinoRaw,
      etiqueta: plan.etiqueta,
      anterior: plan.anterior,
    });
  }
  guardarRespaldo();
  console.log(`\nRespaldo previo escrito en: ${archivo}`);

  let escritos = 0;
  for (const plan of conCambios) {
    if (!Object.keys(plan.set).length) continue;
    const resultado = await dbDestino
      .collection(plan.coleccion)
      .updateOne({ _id: plan.idDestinoRaw as ObjectId }, { $set: plan.set });
    if (!resultado.matchedCount) {
      // No debería ocurrir: el documento se acaba de leer de esta misma base. Si pasa, es mejor
      // parar que seguir dejando la mitad de las fotos copiadas y la otra mitad no.
      throw new Error(
        `No se encontró ${plan.coleccion}/${plan.etiqueta} (_id ${plan.idDestino}) al escribir. ` +
          `Lo ya escrito se deshace con --rollback "${archivo}".`
      );
    }
    escritos += 1;
  }

  let insertados = 0;
  if (args.insertMissing) {
    for (const plan of faltantes) {
      const resultado = await dbDestino.collection(plan.coleccion).insertOne(plan.docOrigen as Document);
      aplicados.push({
        coleccion: plan.coleccion,
        idDestino: resultado.insertedId,
        etiqueta: plan.etiqueta,
        anterior: {},
        insertado: true,
      });
      // Cada inserción se anota en el respaldo en cuanto ocurre: es la única forma de saber luego
      // qué documentos creó ESTA corrida y, por tanto, cuáles puede borrar el `--rollback`.
      guardarRespaldo();
      insertados += 1;
    }
  }

  console.log(`\nAplicado. ${escritos} documento(s) actualizados, ${insertados} insertado(s).`);
  console.log(`Respaldo para deshacer: ${archivo}`);
  console.log(
    `  npx ts-node src/scripts/syncMediaToDb.ts --target "<uri destino>" --rollback "${archivo}"`
  );

  await Promise.all([clienteOrigen.close(), clienteDestino.close()]);
}

// Solo corre cuando se invoca este archivo. Importarlo (lo hacen las pruebas) no debe conectar a
// ninguna base ni, mucho menos, escribirle.
if (/syncMediaToDb(\.ts|\.js)?$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
