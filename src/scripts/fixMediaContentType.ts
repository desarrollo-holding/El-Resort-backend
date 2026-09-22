/**
 * Repara el `Content-Type` de los objetos ya subidos al bucket — NO toca Mongo.
 *
 *   npx ts-node src/scripts/fixMediaContentType.ts            (simulación: solo lista)
 *   npx ts-node src/scripts/fixMediaContentType.ts --apply    (escribe la metadata)
 *   npx ts-node src/scripts/fixMediaContentType.ts --prefix videos/
 *
 * POR QUÉ HACE FALTA
 * Hasta el arreglo de `csStorage.service.ts`, un objeto plano (vídeo, archivo) se guardaba con el
 * MIME que declaró el navegador. En Windows ese valor llega vacío o `application/octet-stream`
 * cuando la extensión no está asociada en el registro, así que el vídeo quedó PUBLICADO como
 * `application/octet-stream`. El `<video>` decide por la cabecera, no por los bytes: con un tipo
 * que no es de medios descarta la fuente y el navegador tira «NotSupportedError: The element has no
 * supported sources». Ver services/mediaContentType.ts.
 *
 * El arreglo del servicio solo cubre las subidas NUEVAS. Los archivos que ya están en el bucket
 * siguen con la cabecera mala hasta que alguien la corrija, y eso es lo que hace esto: un PATCH de
 * metadata, sin volver a subir ni un byte y sin cambiar la clave, así que las URLs guardadas en
 * Mongo siguen siendo válidas y no hay nada que migrar.
 *
 * TAMBIÉN AVISA (sin arreglar) de las claves cuyo nombre original lleva caracteres que rompen la
 * URL (`#`, `?`, `%`). Esas no se pueden reparar desde acá: la URL mala ya está guardada en el
 * documento, y la única salida limpia es volver a subir el archivo desde el panel — con el servicio
 * ya arreglado, la URL nueva sale codificada.
 */
import dotenv from "dotenv";
import { Storage } from "@google-cloud/storage";
import { getGcsConfigFromEnv } from "../config/gcs";
import { extensionOf, storedContentTypeNeedsFix } from "../services/mediaContentType";

dotenv.config();

const APPLY = process.argv.includes("--apply");

/** Carpetas a revisar. Son las que escribe `GcsStorageService.uploadFile` como objeto plano. */
const DEFAULT_PREFIXES = ["videos/", "files/"];

/** Caracteres que, sin codificar, parten la URL antes de llegar al objeto. */
const URL_BREAKING_RE = /[#?%]/;

/**
 * Contenedores que NINGÚN navegador reproduce, por mucho que la cabecera sea correcta. El panel
 * acepta cualquier `video/*` a propósito (el formato lo decide quien carga el contenido), así que
 * un `.avi` o un `.mkv` subido por error da exactamente el mismo síntoma que la cabecera mala
 * —«NotSupportedError»— y conviene distinguirlos de un vistazo: estos hay que reconvertirlos a MP4
 * (H.264 + AAC) y volver a subirlos, no hay arreglo del lado del servidor.
 */
const UNPLAYABLE_EXTENSIONS = new Set(["avi", "mkv", "wmv", "flv", "mpeg", "mpg", "3gp", "ts", "mts"]);

/**
 * `.mov` es el caso ambiguo y por eso va aparte: si dentro lleva H.264 se reproduce, y si lleva
 * HEVC/ProRes (lo que graba un iPhone por defecto) no lo abre ni Chrome ni Firefox. Desde acá no se
 * puede saber cuál es sin leer el archivo, así que solo se avisa.
 */
const RISKY_EXTENSIONS = new Set(["mov"]);

const prefixesFromArgv = (): string[] => {
  const index = process.argv.indexOf("--prefix");
  if (index < 0 || !process.argv[index + 1]) return DEFAULT_PREFIXES;
  return [process.argv[index + 1]];
};

async function main() {
  const { bucket: bucketName, credentials } = getGcsConfigFromEnv();
  const bucket = new Storage({ credentials }).bucket(bucketName);

  console.log(`\nBucket: ${bucketName}${APPLY ? "" : "   (simulación — no escribe nada)"}`);

  let revisados = 0;
  const pendientes: { key: string; actual: string; esperado: string }[] = [];
  const clavesRiesgosas: string[] = [];
  const formatosIrreproducibles: string[] = [];
  const formatosDudosos: string[] = [];

  for (const prefix of prefixesFromArgv()) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      revisados += 1;
      if (URL_BREAKING_RE.test(file.name)) clavesRiesgosas.push(file.name);

      const extension = extensionOf(file.name);
      if (UNPLAYABLE_EXTENSIONS.has(extension)) formatosIrreproducibles.push(file.name);
      else if (RISKY_EXTENSIONS.has(extension)) formatosDudosos.push(file.name);

      const actual = (file.metadata.contentType as string | undefined) ?? "";
      const esperado = storedContentTypeNeedsFix(file.name, actual);
      if (esperado) pendientes.push({ key: file.name, actual: actual || "(sin tipo)", esperado });
    }
  }

  console.log(`\n${revisados} objetos revisados, ${pendientes.length} con el tipo equivocado.\n`);

  if (pendientes.length === 0) {
    console.log("  Nada que corregir.");
  } else {
    for (const item of pendientes) {
      console.log(`  ${item.key}\n      ${item.actual}  →  ${item.esperado}`);
    }
  }

  if (formatosIrreproducibles.length > 0) {
    console.log(
      `
── ${formatosIrreproducibles.length} objeto(s) en un contenedor que el navegador NO reproduce ────`
    );
    console.log("   La cabecera no los arregla: hay que reconvertirlos a MP4 (H.264 + AAC) y volver a subirlos.");
    for (const key of formatosIrreproducibles) console.log(`  ${key}`);
  }

  if (formatosDudosos.length > 0) {
    console.log(`
── ${formatosDudosos.length} objeto(s) .mov — se reproducen SOLO si por dentro son H.264 ────`);
    console.log("   Un .mov de iPhone suele ser HEVC y no lo abre ningún navegador. Si sigue sin verse, reconvertir.");
    for (const key of formatosDudosos) console.log(`  ${key}`);
  }

  if (clavesRiesgosas.length > 0) {
    console.log(
      `\n── ${clavesRiesgosas.length} objeto(s) con caracteres que rompen la URL (#, ?, %) ────────────────`
    );
    console.log("   Esto NO lo arregla el script: hay que volver a subir el archivo desde el panel.");
    for (const key of clavesRiesgosas) console.log(`  ${key}`);
  }

  if (!APPLY) {
    if (pendientes.length > 0) console.log("\nVolvé a correrlo con --apply para escribir la metadata.");
    return;
  }

  let corregidos = 0;
  for (const item of pendientes) {
    try {
      // PATCH de metadata: `setMetadata` solo pisa los campos que se le pasan, así que el
      // `cacheControl` inmutable que puso la subida se conserva.
      await bucket.file(item.key).setMetadata({ contentType: item.esperado });
      corregidos += 1;
    } catch (error) {
      console.error(`  ! no se pudo corregir ${item.key}:`, (error as Error)?.message ?? error);
    }
  }

  console.log(`\n${corregidos}/${pendientes.length} objetos corregidos.`);
  if (corregidos > 0) {
    console.log(
      "El objeto cambió de metadata pero no de bytes ni de clave, y se sirve con " +
        "`Cache-Control: immutable`: purgá el borde (scripts/purgeCloudflare.mjs del front) o " +
        "recargá con caché desactivada para ver el efecto."
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
