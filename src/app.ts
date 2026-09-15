import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import _ from "lodash";
import { corsConfig } from "./config/cors";
import { connectDB } from "./config/db";
import swaggerUi from "swagger-ui-express";
import { createSwaggerSpec } from "./config/swagger";
import authRoutes from "./Routes/authRoutes";
import extraRoutes from "./Routes/extraRoutes";
import areaRoutes from "./Routes/areaRoutes";
import reservationRoutes from "./Routes/reservationRoutes";
import customFieldsRoutes from "./Routes/customFieldsRoutes";
import ratesRoutes from "./Routes/ratesRoutes";
import roomsRoutes from "./Routes/roomsRoutes";
import taxesRoutes from "./Routes/taxesRoutes";
import itemsRoutes from "./Routes/itemsRoutes";
import izipayRoutes from "./Routes/izipayRoutes";
import roomTypeLocalSpecsRoutes from "./Routes/roomTypeLocalSpecsRoutes";
import condominiosRoutes from "./Routes/condominiosRoutes";
import retirosRoutes from "./Routes/retirosRoutes";
import fullDaysRoutes from "./Routes/fullDaysRoutes";
import textosLandingPageRoutes from "./Routes/textosLandingPageRoutes";
import landingPageSectionsRoutes from "./Routes/landingPageSectionsRoutes";
import translateRoutes from "./Routes/translateRoutes";
import landingMediaRoutes from "./Routes/landingMediaRoutes";
import reviewsRoutes from "./Routes/reviewsRoutes";
import beneficiosRoutes from "./Routes/beneficiosRoutes";
import claimsRoutes from "./Routes/claimsRoutes";
import publicMediaUrls from "./middleware/publicMediaUrls";
import globalLimiter from "./middleware/globalLimiter";
import { publicContentCache, CONTENT_CACHE_HEADER, ROOMS_CACHE_HEADER } from "./middleware/publicContentCache";

dotenv.config();

if (process.env.DATABASE_URL) {
  void connectDB();
} else {
  console.warn("DATABASE_URL no configurado; MongoDB no se conectarÃ¡.");
}

const swaggerSpec = createSwaggerSpec();

const app = express();

/**
 * Railway pone un proxy de borde delante del proceso, así que sin esto `req.ip` es la IP del
 * proxy y no la del visitante. `express-rate-limit` usa `req.ip` como clave: sin `trust proxy`
 * TODOS los visitantes caen en el mismo cubo y los límites castigan a usuarios legítimos (5
 * reclamos en toda la web bloquearían el formulario para el resto) sin frenar a un atacante.
 * `1` = confiar solo en el primer proxy, que es el de Railway.
 */
app.set("trust proxy", 1);

app.use(cors(corsConfig));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.set("json replacer", (key: string, value: unknown) =>
  key === "__proto__" ? undefined : value
);

// Antes de las rutas: reescribe las URLs de medios de TODA respuesta JSON al origen público
// (`MEDIA_PUBLIC_BASE_URL`). Inerte si esa variable no está definida — ver services/publicMedia.ts.
app.use(publicMediaUrls);

// `_.omit` no sabe de arrays: si se le pasa uno, lo convierte en un objeto plano
// ({0: ..., 1: ...}) y pierde `Array.isArray`. Los endpoints que esperan un body
// array (p. ej. PUT /areas/orden) recursamos manualmente para no perder el tipo.
const sanitizeInput = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInput(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    return _.omit(value as object, ["__proto__", "constructor", "prototype"]) as T;
  }
  return value;
};

app.use((req, res, next) => {
  req.body = sanitizeInput(req.body);
  req.query = sanitizeInput(req.query);
  req.params = sanitizeInput(req.params) as typeof req.params;
  next();
});

app.get("/api/docs/openapi.json", (_req, res) => {
  res.json(swaggerSpec);
});

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    swaggerOptions: {
      url: "/api/docs/openapi.json",
      displayRequestDuration: true,
    },
  })
);

// Techo global por IP. No hay ninguna ruta que legítimamente necesite más que esto desde un solo
// cliente, y acota el daño de un bot que golpee en bucle los endpoints públicos de contenido
// (que son los que, con la caché fría, pueden llegar al traductor).
app.use("/api", globalLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/extras", publicContentCache(CONTENT_CACHE_HEADER), extraRoutes);
app.use("/api/areas", publicContentCache(CONTENT_CACHE_HEADER), areaRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/customfields", customFieldsRoutes);
app.use("/api/rates", ratesRoutes);
app.use("/api/rooms", publicContentCache(ROOMS_CACHE_HEADER), roomsRoutes);
app.use("/api/taxes", taxesRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/izipay", izipayRoutes);
app.use("/api/room-type-specs", publicContentCache(ROOMS_CACHE_HEADER), roomTypeLocalSpecsRoutes);
app.use("/api/condominios", condominiosRoutes);
app.use("/api/retiros", publicContentCache(CONTENT_CACHE_HEADER), retirosRoutes);
app.use("/api/full-days", publicContentCache(CONTENT_CACHE_HEADER), fullDaysRoutes);
app.use("/api/textos-landing-page", publicContentCache(CONTENT_CACHE_HEADER), textosLandingPageRoutes);
app.use("/api/landing-page-sections", publicContentCache(CONTENT_CACHE_HEADER), landingPageSectionsRoutes);
app.use("/api/landing-media", publicContentCache(CONTENT_CACHE_HEADER), landingMediaRoutes);
app.use("/api/reviews", publicContentCache(CONTENT_CACHE_HEADER), reviewsRoutes);
app.use("/api/beneficios", publicContentCache(CONTENT_CACHE_HEADER), beneficiosRoutes);
app.use("/api/translate", translateRoutes);
app.use("/api/claims", claimsRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    err &&
    typeof err === "object" &&
    (err as { type?: unknown }).type === "entity.parse.failed" &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    res.status(400).json({ error: "JSON inválido (revisa comas finales y comillas dobles)" });
    return;
  }

  next(err);
});


// mostrar los errores bonitos

export default app;
