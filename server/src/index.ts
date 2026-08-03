import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { handleSftpSocket } from "./sftp-session.js";
import { handleSshSocket } from "./ssh-session.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();
app.use(
  cors({
    origin: CLIENT_ORIGIN === "*" ? true : [CLIENT_ORIGIN, "http://127.0.0.1:5173"],
  }),
);
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "openterm-server",
    storesCredentials: false,
    note: "Credentials are accepted only in-memory for live sessions and never persisted.",
  });
});

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (pathname === "/ws/ssh" || pathname === "/ws/sftp") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (pathname === "/ws/ssh") {
        handleSshSocket(ws);
      } else {
        handleSftpSocket(ws);
      }
    });
    return;
  }

  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`OpenTerm server listening on http://${HOST}:${PORT}`);
  console.log("Credential persistence: disabled (session memory only)");
});
