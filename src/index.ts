import dotenv from 'dotenv';
dotenv.config(); 
import colors from "colors";
import app from "./app";


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
