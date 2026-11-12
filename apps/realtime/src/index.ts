import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { loadEnv } from "@gukirana/config";
import { createLogger } from "@gukirana/observability";
import { WorldRoom } from "./rooms/world-room.js";
import { MatchRoom } from "./rooms/match-room.js";

const env = loadEnv();
const logger = createLogger("realtime", env.LOG_LEVEL);

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "realtime", version: "0.0.0", time: new Date().toISOString() }));
    return;
  }
  res.writeHead(404).end();
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
gameServer.define("plaza", WorldRoom);
gameServer.define("match", MatchRoom);

await gameServer.listen(env.REALTIME_PORT);
logger.info({ port: env.REALTIME_PORT }, "realtime listening");
