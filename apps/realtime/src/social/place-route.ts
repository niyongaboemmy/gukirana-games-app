import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyToken } from "../auth.js";
import { placeHolds } from "./place-holds.js";

/**
 * `GET /place` (P2-NET-06): the caller's own held place, or the place released while they were away (PlaceMsg).
 * Bearer access token only (no cookies, so any web origin may ask: the answer is about the token's account alone).
 */
export async function placeRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-max-age": "600",
    "cache-control": "no-store",
  };
  if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
  if (req.method !== "GET") return void res.writeHead(405, cors).end();
  const auth = req.headers.authorization ?? "";
  const claims = auth.startsWith("Bearer ") ? await verifyToken(auth.slice(7)) : null;
  if (!claims) return void res.writeHead(401, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ code: "UNAUTHORIZED" }));
  res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify(placeHolds.view(claims.sub)));
}
