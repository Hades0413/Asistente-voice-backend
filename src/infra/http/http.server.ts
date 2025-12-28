import http, { Server } from "node:http";
import app from "../../app";
import logger from "../../shared/logger";

export function createHttpServer(): Server {
  const server = http.createServer(app);

  server.on("error", (err) => {
    logger.error("HTTP server error:", err);
    process.exit(1);
  });

  server.on("listening", () => {
    const addr = server.address();
    const bind =
      typeof addr === "string" ? `pipe ${addr}` : `port ${addr?.port}`;
    logger.info(`HTTP server listening on ${bind}`);
  });

  return server;
}
