import dotenv from 'dotenv';
dotenv.config(); 
import colors from "colors";
import app from "./app";


/**
 * Aviso temprano de configuración del traductor. Sin esto, una `GEMINI_API_KEY` ausente o mal
 * puesta en Railway no se nota: Gemini falla, el fallback devuelve el español y la web en inglés
 * se llena de español sin que nadie se entere hasta que un usuario lo reporta.
 */
const geminiKeyPresente = Boolean((process.env.GEMINI_API_KEY || "").trim());
if (!geminiKeyPresente) {
  console.error(
    colors.red.bold(
      "[startup] GEMINI_API_KEY NO configurada: la traduccion al ingles NO funcionara y el contenido quedara en espanol."
    )
  );
} else {
  console.log(
    colors.gray(
      `[startup] Traduccion: GEMINI_API_KEY presente, modelo=${process.env.GEMINI_MODEL || "gemini-flash-latest"}, libretranslate=${process.env.LIBRETRANSLATE_BASE_URL || "(sin configurar)"}`
    )
  );
}

const requestedPort = Number(process.env.PORT || 4000);
const maxRetries = 10;

const startServer = (port: number, retriesLeft: number): void => {
  const server = app.listen(port, () => {
    console.log(colors.cyan.bold(`Servidor corriendo en http://localhost:${port}`));
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && retriesLeft > 0) {
      const nextPort = port + 1;
      console.warn(colors.yellow(`Puerto ${port} en uso. Reintentando en ${nextPort}...`));
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    console.error(colors.red("No se pudo iniciar el servidor:"), error.message);
    process.exit(1);
  });
};

startServer(requestedPort, maxRetries);
