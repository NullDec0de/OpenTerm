import { Client, type SFTPWrapper } from "ssh2";
import type { WebSocket } from "ws";
import type { ClientMessage, ConnectPayload, ServerMessage, SftpEntry } from "./types.js";

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function joinPath(dir: string, name: string) {
  if (dir.endsWith("/")) return `${dir}${name}`;
  if (!dir || dir === ".") return name;
  return `${dir}/${name}`;
}

export function handleSftpSocket(ws: WebSocket) {
  let client: Client | null = null;
  let sftp: SFTPWrapper | null = null;
  let connected = false;

  const cleanup = () => {
    try {
      sftp?.end();
    } catch {
      /* ignore */
    }
    try {
      client?.end();
    } catch {
      /* ignore */
    }
    sftp = null;
    client = null;
    connected = false;
  };

  const reply = (
    requestId: string,
    payload: Omit<Extract<ServerMessage, { type: "sftp:result" }>, "type" | "requestId">,
  ) => {
    send(ws, { type: "sftp:result", requestId, ...payload });
  };

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      send(ws, { type: "error", message: "Invalid message JSON" });
      return;
    }

    if (msg.type === "connect") {
      if (connected) {
        send(ws, { type: "error", message: "Already connected" });
        return;
      }

      const host = msg.host?.trim();
      const username = msg.username?.trim();
      const port = msg.port && msg.port > 0 ? msg.port : 22;
      if (!host || !username) {
        send(ws, { type: "error", message: "Host and username are required" });
        return;
      }

      void (msg as ConnectPayload);

      client = new Client();
      client
        .on("ready", () => {
          client!.sftp((err, sftpConn) => {
            if (err) {
              send(ws, { type: "error", message: err.message });
              cleanup();
              return;
            }
            sftp = sftpConn;
            connected = true;
            send(ws, { type: "ready" });
          });
        })
        .on("error", (err) => {
          send(ws, { type: "error", message: err.message });
          cleanup();
        })
        .on("close", () => {
          if (connected) send(ws, { type: "closed" });
          cleanup();
        });

      const connectConfig: Record<string, unknown> = {
        host,
        port,
        username,
        readyTimeout: 20000,
      };

      if (msg.auth.method === "password") {
        connectConfig.password = msg.auth.password;
      } else {
        connectConfig.privateKey = msg.auth.privateKey;
        if (msg.auth.passphrase) {
          connectConfig.passphrase = msg.auth.passphrase;
        }
      }

      client.connect(connectConfig as Parameters<Client["connect"]>[0]);
      return;
    }

    if (!connected || !sftp) {
      if ("requestId" in msg) {
        reply(msg.requestId, { ok: false, error: "Not connected" });
      } else if (msg.type !== "disconnect") {
        send(ws, { type: "error", message: "Not connected" });
      }
      return;
    }

    if (msg.type === "disconnect") {
      cleanup();
      send(ws, { type: "closed" });
      return;
    }

    if (msg.type === "sftp:list") {
      sftp.readdir(msg.path || ".", (err, list) => {
        if (err) {
          reply(msg.requestId, { ok: false, error: err.message });
          return;
        }
        const entries: SftpEntry[] = list
          .map((item) => ({
            name: item.filename,
            path: joinPath(msg.path || ".", item.filename),
            isDirectory: (item.attrs.mode & 0o170000) === 0o040000,
            size: item.attrs.size ?? 0,
            modifyTime: (item.attrs.mtime ?? 0) * 1000,
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        reply(msg.requestId, { ok: true, entries, path: msg.path || "." });
      });
      return;
    }

    if (msg.type === "sftp:download") {
      const chunks: Buffer[] = [];
      const readStream = sftp.createReadStream(msg.path);
      readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      readStream.on("error", (err: Error) => {
        reply(msg.requestId, { ok: false, error: err.message });
      });
      readStream.on("end", () => {
        const content = Buffer.concat(chunks);
        if (content.length > 8 * 1024 * 1024) {
          reply(msg.requestId, {
            ok: false,
            error: "File too large for browser download (>8MB)",
          });
          return;
        }
        reply(msg.requestId, {
          ok: true,
          contentBase64: content.toString("base64"),
          path: msg.path,
        });
      });
      return;
    }

    if (msg.type === "sftp:upload") {
      const content = Buffer.from(msg.contentBase64, "base64");
      if (content.length > 8 * 1024 * 1024) {
        reply(msg.requestId, { ok: false, error: "File too large for upload (>8MB)" });
        return;
      }
      const writeStream = sftp.createWriteStream(msg.path);
      writeStream.on("error", (err: Error) => {
        reply(msg.requestId, { ok: false, error: err.message });
      });
      writeStream.on("close", () => {
        reply(msg.requestId, { ok: true, path: msg.path });
      });
      writeStream.end(content);
      return;
    }

    if (msg.type === "sftp:mkdir") {
      sftp.mkdir(msg.path, (err) => {
        if (err) reply(msg.requestId, { ok: false, error: err.message });
        else reply(msg.requestId, { ok: true, path: msg.path });
      });
      return;
    }

    if (msg.type === "sftp:delete") {
      const done = (err: Error | undefined | null) => {
        if (err) reply(msg.requestId, { ok: false, error: err.message });
        else reply(msg.requestId, { ok: true, path: msg.path });
      };
      if (msg.isDir) sftp.rmdir(msg.path, done);
      else sftp.unlink(msg.path, done);
      return;
    }

    if (msg.type === "sftp:rename") {
      sftp.rename(msg.from, msg.to, (err) => {
        if (err) reply(msg.requestId, { ok: false, error: err.message });
        else reply(msg.requestId, { ok: true, path: msg.to });
      });
    }
  });

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
