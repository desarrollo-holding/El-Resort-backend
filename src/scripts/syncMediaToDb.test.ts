/**
 * Pruebas de la fusión de medios. Lo que se comprueba aquí no es "que copie": es que NO copie de
 * más. El riesgo real de este script es escribirle a la base de producción un precio, un texto o
 * una traducción del entorno equivocado, así que cada caso fija una de esas fronteras.
 *
 * Las formas de documento son las de la base real (`areas.imagenes[]`, el árbol de
 * `landingmedias.json`, `roomtypelocalspecs.bedrooms[].photos[]`), recortadas a lo mínimo.
 */
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { esUrlDeMedio, fusionarMedios, planificarDoc } from "./syncMediaToDb";

const BUCKET = "https://storage.googleapis.com/greendreams_bucket/fotosresort";

const asset = (nombre: string) => ({
  url: `${BUCKET}/${nombre}/orig.webp`,
  storageKey: `fotosresort/${nombre}/orig.webp`,
  storagePrefix: `fotosresort/${nombre}`,
  width: 1600,
  height: 900,
  variants: [{ width: 480, height: 270, format: "webp", url: `${BUCKET}/${nombre}/w480.webp` }],
});

const planear = (coleccion: string, origen: Record<string, unknown>, destino: Record<string, unknown>) =>
  planificarDoc(
    coleccion,
    { _id: new ObjectId(), ...origen },
    { _id: new ObjectId(), ...destino },
    "_id",
    "media"
  );

const fusionar = (origen: unknown, destino: unknown, soloAgregar = false) => {
  const ctx = {
    cambios: [] as { path: string; de: unknown; a: unknown }[],
    saltos: [] as { path: string; motivo: string }[],
    omisiones: [] as { path: string; conserva: unknown; ignora: unknown }[],
    soloAgregar,
  };
  const resultado = fusionarMedios(origen, destino, "campo", ctx);
  return { resultado, ...ctx };
};

describe("esUrlDeMedio", () => {
  it("reconoce las URL de los dos buckets y las de otros orígenes con extensión", () => {
    expect(esUrlDeMedio(`${BUCKET}/x/orig.webp`)).toBe(true);
    expect(esUrlDeMedio("https://storage.googleapis.com/marketing_gallery/videos/1789.mp4")).toBe(true);
    expect(esUrlDeMedio("https://res.cloudinary.com/demo/image/upload/foto.jpg")).toBe(true);
  });

  it("no toma por medio un texto cualquiera ni una URL sin extensión", () => {
    expect(esUrlDeMedio("Cabaña frente al lago")).toBe(false);
    expect(esUrlDeMedio("https://elresort.pe/habitaciones")).toBe(false);
    expect(esUrlDeMedio(1200)).toBe(false);
  });
});

describe("fusionarMedios", () => {
  it("copia la galería entera, sin dejar colgando las fotos sobrantes del destino", () => {
    const origen = [asset("nueva-1"), asset("nueva-2")];
    const destino = [asset("vieja-1"), asset("vieja-2"), asset("vieja-3")];

    const { resultado, cambios } = fusionar(origen, destino);

    expect(resultado).toEqual(origen);
    expect(cambios).toHaveLength(1);
  });

  it("no toca la rama del destino si el origen trae exactamente lo mismo", () => {
    const { cambios } = fusionar([asset("misma")], [asset("misma")]);
    expect(cambios).toEqual([]);
  });

  it("dentro de un array de objetos mixtos copia la foto y deja la descripción del destino", () => {
    const origen = [{ number: 1, description: "texto de DESARROLLO", photos: [asset("foto-nueva")] }];
    const destino = [{ number: 1, description: "texto revisado en PRODUCCIÓN", photos: [asset("foto-vieja")] }];

    const { resultado } = fusionar(origen, destino);

    expect((resultado as typeof destino)[0].description).toBe("texto revisado en PRODUCCIÓN");
    expect((resultado as typeof destino)[0].photos).toEqual([asset("foto-nueva")]);
  });

  it("salta, en vez de inventar, el elemento de array que el destino no tiene", () => {
    const origen = [{ description: "dorm 1", photos: [asset("a")] }, { description: "dorm 2", photos: [asset("b")] }];
    const destino = [{ description: "dorm 1", photos: [asset("a")] }];

    const { resultado, saltos } = fusionar(origen, destino);

    expect(resultado).toHaveLength(1);
    expect(saltos).toEqual([{ path: "campo.1", motivo: "el destino no tiene ese elemento del array" }]);
  });

  it("en el árbol de landingmedias cambia la imagen y respeta la configuración vecina", () => {
    const origen = {
      mainImage: { ...asset("hero-nuevo"), kind: "image", status: "existing" },
      background: { type: "texture", color: null, textureKey: "textura-DEV", overlayOpacity: 0.4 },
    };
    const destino = {
      mainImage: { ...asset("hero-viejo"), kind: "image", status: "existing" },
      background: { type: "color", color: "#0a0a0a", textureKey: null, overlayOpacity: 0.7 },
    };

    const { resultado } = fusionar(origen, destino);

    expect((resultado as typeof origen).mainImage.url).toBe(origen.mainImage.url);
    expect((resultado as typeof destino).background).toEqual(destino.background);
  });

  it("borra del destino la marca de pipeline que el origen ya no tiene", () => {
    const origen = asset("repuesta");
    const destino = { ...asset("repuesta"), legacyUrl: `${BUCKET}/vieja.webp`, legacyStorageKey: "fotosresort/vieja.webp" };

    const { resultado } = fusionar(origen, destino);

    expect(resultado).not.toHaveProperty("legacyUrl");
    expect(resultado).not.toHaveProperty("legacyStorageKey");
  });

  it("crea la rama completa cuando el destino no tiene el campo", () => {
    const { resultado, cambios } = fusionar(asset("portada"), undefined);
    expect(resultado).toEqual(asset("portada"));
    expect(cambios).toHaveLength(1);
  });
});

describe("fusionarMedios con --solo-agregar", () => {
  it("une las galerías: el destino no pierde ninguna de sus fotos", () => {
    const origen = [asset("dev-1"), asset("dev-2")];
    const destino = [asset("prod-1"), asset("prod-2"), asset("prod-3")];

    const { resultado } = fusionar(origen, destino, true);

    expect(resultado).toEqual([...destino, ...origen]);
  });

  it("no duplica una foto que ya está en el destino, y la conserva en su sitio", () => {
    const origen = [asset("compartida"), asset("nueva")];
    const destino = [asset("propia-de-prod"), asset("compartida")];

    const { resultado } = fusionar(origen, destino, true);

    expect(resultado).toEqual([asset("propia-de-prod"), asset("compartida"), asset("nueva")]);
  });

  it("completa las variantes de una foto que el destino tenía sin ellas", () => {
    const sinVariantes = { url: asset("x").url, storageKey: asset("x").storageKey };
    const { resultado } = fusionar([asset("x")], [sinVariantes], true);
    expect(resultado).toEqual([asset("x")]);
  });

  it("no pisa la portada que el destino ya tiene: la anota como omisión", () => {
    const { resultado, omisiones, cambios } = fusionar(asset("dev"), asset("prod"), true);

    expect(resultado).toEqual(asset("prod"));
    expect(cambios).toEqual([]);
    expect(omisiones).toEqual([
      { path: "campo", conserva: asset("prod").url, ignora: asset("dev").url },
    ]);
  });

  it("sí rellena la portada cuando el destino no tiene ninguna", () => {
    const { resultado, omisiones } = fusionar(asset("dev"), undefined, true);
    expect(resultado).toEqual(asset("dev"));
    expect(omisiones).toEqual([]);
  });

  it("no pisa un iconUrl que el destino ya tiene (campo String plano)", () => {
    const { resultado, omisiones } = fusionar(`${BUCKET}/dev/orig.webp`, `${BUCKET}/prod/orig.webp`, true);
    expect(resultado).toBe(`${BUCKET}/prod/orig.webp`);
    expect(omisiones).toHaveLength(1);
  });

  it("si la URL y el storageKey del destino no concuerdan, manda la URL y no se pisa la foto", () => {
    // Estado real posible: alguien cambió la URL a mano y `storageKey` se quedó con la marca vieja.
    const destinoDescuadrado = { ...asset("dev"), url: `${BUCKET}/OTRA-FOTO/orig.webp` };

    const { resultado, omisiones } = fusionar(asset("dev"), destinoDescuadrado, true);

    expect(resultado).toEqual(destinoDescuadrado);
    expect(omisiones).toHaveLength(1);
  });

  it("conserva el legacyUrl del destino en vez de borrarlo", () => {
    const destino = { ...asset("misma"), legacyUrl: `${BUCKET}/original.jpg` };
    const { resultado } = fusionar(asset("misma"), destino, true);
    expect(resultado).toHaveProperty("legacyUrl", `${BUCKET}/original.jpg`);
  });
});

describe("planificarDoc", () => {
  it("solo pone en el $set los campos con fotos: precios, textos y traducciones no se tocan", () => {
    const plan = planear(
      "extras",
      { nombre: "Masaje", precio: 120, descripcionEn: "texto de dev", imagenes: [asset("masaje-nuevo")] },
      { nombre: "Masaje", precio: 150, descripcionEn: "texto revisado en prod", imagenes: [asset("masaje-viejo")] }
    );

    expect(Object.keys(plan.set)).toEqual(["imagenes"]);
    expect(plan.anterior).toEqual({ imagenes: [asset("masaje-viejo")] });
  });

  it("no planifica nada cuando las fotos ya coinciden", () => {
    const plan = planear(
      "areas",
      { nombre: "Lago", imagenes: [asset("lago")], orden: 1 },
      { nombre: "Lago", imagenes: [asset("lago")], orden: 9 }
    );

    expect(plan.cambios).toEqual([]);
    expect(plan.set).toEqual({});
  });

  it("arrastra el encuadre de las portadas junto con la foto", () => {
    const plan = planear(
      "roomtypelocalspecs",
      { roomTypeID: 545124, portada: asset("portada-nueva"), posicion_fotos_portadas: { portada: "center 30%" } },
      { roomTypeID: 545124, portada: asset("portada-vieja"), posicion_fotos_portadas: { portada: "center 70%" } }
    );

    expect(plan.set.portada).toEqual(asset("portada-nueva"));
    expect(plan.set.posicion_fotos_portadas).toEqual({ portada: "center 30%" });
  });

  it("copia el iconUrl de beneficios, que en el esquema es un String plano", () => {
    const plan = planear(
      "beneficios",
      { nombre: "Wifi", iconUrl: `${BUCKET}/icono-nuevo/orig.webp`, iconFileId: "nuevo", orden: 1 },
      { nombre: "Wifi", iconUrl: `${BUCKET}/icono-viejo/orig.webp`, iconFileId: "viejo", orden: 4 }
    );

    expect(plan.set).toEqual({ iconUrl: `${BUCKET}/icono-nuevo/orig.webp`, iconFileId: "nuevo" });
  });

  it("con --solo-agregar conserva el encuadre de la portada que el destino ya tenía", () => {
    const plan = planificarDoc(
      "roomtypelocalspecs",
      { _id: new ObjectId(), roomTypeID: 1, portada: asset("dev"), posicion_fotos_portadas: { portada: "center 30%" } },
      { _id: new ObjectId(), roomTypeID: 1, portada: asset("prod"), posicion_fotos_portadas: { portada: "center 70%" } },
      "_id",
      "media",
      true
    );

    expect(plan.set).toEqual({});
    expect(plan.omisiones).toHaveLength(1);
  });

  it("con --solo-agregar añade las fotos nuevas sin quitar las de producción", () => {
    const plan = planificarDoc(
      "areas",
      { _id: new ObjectId(), nombre: "Lago", imagenes: [asset("dev-1")], descripcion: "texto de dev" },
      { _id: new ObjectId(), nombre: "Lago", imagenes: [asset("prod-1")], descripcion: "texto de prod" },
      "_id",
      "media",
      true
    );

    expect(plan.set).toEqual({ imagenes: [asset("prod-1"), asset("dev-1")] });
  });

  it("en modo full-doc sí reemplaza todo lo que difiere", () => {
    const plan = planificarDoc(
      "extras",
      { _id: new ObjectId(), nombre: "Masaje", precio: 120, imagenes: [asset("a")] },
      { _id: new ObjectId(), nombre: "Masaje", precio: 150, imagenes: [asset("b")] },
      "_id",
      "full-doc"
    );

    expect(plan.set).toEqual({ precio: 120, imagenes: [asset("a")] });
  });
});
