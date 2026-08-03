import { Client, type ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import type { ClientMessage, ConnectPayload, ServerMessage } from "./types.js";

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function scrubConnect(payload: ConnectPayload): Omit<ConnectPayload, "auth"> & {
  auth: { method: string };
} {
  return {
    type: payload.type,
    host: payload.host,
    port: payload.port,
    username: payload.username,
    cols: payload.cols,
    rows: payload.rows,
    term: payload.term,
    auth: { method: payload.auth.method },
  };
}

export function handleSshSocket(ws: WebSocket) {
  let client: Client | null = null;
  let stream: ClientChannel | null = null;
  let connected = false;

  const cleanup = () => {
    try {
      stream?.close();
    } catch {
      /* ignore */
    }
    try {
      client?.end();
    } catch {
      /* ignore */
    }
    stream = null;
    client = null;
    connected = false;
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

      // Credentials stay in process memory for this socket only and are never logged.
      void scrubConnect(msg);

      client = new Client();
      client
        .on("ready", () => {
          connected = true;
          client!.shell(
            {
              term: msg.term || "xterm-256color",
              cols: msg.cols || 120,
              rows: msg.rows || 40,
            },
            (err, channel) => {
              if (err) {
                send(ws, { type: "error", message: err.message });
                cleanup();
                return;
              }
              stream = channel;
              channel.on("data", (data: Buffer) => {
                send(ws, { type: "data", data: data.toString("utf8") });
              });
              channel.stderr.on("data", (data: Buffer) => {
                send(ws, { type: "data", data: data.toString("utf8") });
              });
              channel.on("close", (code: number | null, signal: string) => {
                send(ws, {
                  type: "closed",
                  code: code ?? undefined,
                  signal: signal || undefined,
                });
                cleanup();
              });
              send(ws, { type: "ready" });
            },
          );
        })
        .on("error", (err) => {
          send(ws, { type: "error", message: err.message });
          cleanup();
        })
        .on("close", () => {
          if (connected) {
            send(ws, { type: "closed" });
          }
          cleanup();
        });

      const connectConfig: Record<string, unknown> = {
        host,
        port,
        username,
        readyTimeout: 20000,
        tryKeyboard: false,
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

    if (!connected || !stream) {
      if (msg.type !== "disconnect") {
        send(ws, { type: "error", message: "Not connected" });
      }
      return;
    }

    if (msg.type === "data") {
      stream.write(msg.data);
      return;
    }

    if (msg.type === "resize") {
      stream.setWindow(msg.rows, msg.cols, 0, 0);
      return;
    }

    if (msg.type === "disconnect") {
      cleanup();
      send(ws, { type: "closed" });
    }
  });

  ws.on("close", () => {
    cleanup();
  });

  ws.on("error", () => {
    cleanup();
  });
}
