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
import textosLandingPageRoutes from "./Routes/textosLandingPageRoutes";
import landingPageSectionsRoutes from "./Routes/landingPageSectionsRoutes";
import translateRoutes from "./Routes/translateRoutes";
import landingMediaRoutes from "./Routes/landingMediaRoutes";
import reviewsRoutes from "./Routes/reviewsRoutes";

dotenv.config();

if (process.env.DATABASE_URL) {
  void connectDB();
} else {
  console.warn("DATABASE_URL no configurado; MongoDB no se conectarÃ¡.");
}

const swaggerSpec = createSwaggerSpec();

const app = express();
app.use(cors(corsConfig));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.set("json replacer", (key: string, value: unknown) =>
  key === "__proto__" ? undefined : value
);

const sanitizeInput = <T extends object>(obj: T): Partial<T> =>
  _.omit(obj, ["__proto__", "constructor", "prototype"]);

app.use((req, res, next) => {
  req.body = sanitizeInput(req.body);
  req.query = sanitizeInput(req.query);
  req.params = sanitizeInput(req.params);
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

app.use("/api/auth", authRoutes);
app.use("/api/extras", extraRoutes);
app.use("/api/areas", areaRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/customfields", customFieldsRoutes);
app.use("/api/rates", ratesRoutes);
app.use("/api/rooms", roomsRoutes);
app.use("/api/taxes", taxesRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/izipay", izipayRoutes);
app.use("/api/room-type-specs", roomTypeLocalSpecsRoutes);
app.use("/api/condominios", condominiosRoutes);
app.use("/api/retiros", retirosRoutes);
app.use("/api/textos-landing-page", textosLandingPageRoutes);
app.use("/api/landing-page-sections", landingPageSectionsRoutes);
app.use("/api/landing-media", landingMediaRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/translate", translateRoutes);

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
