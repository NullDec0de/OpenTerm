import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { ServerProfile } from "../lib/vault";
import { getWsUrl, type ConnectRequest } from "../lib/ws";

type Props = {
  server: ServerProfile;
};

export function TerminalSession({ server }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 14,
      theme: {
        background: "#07100e",
        foreground: "#e8f2ec",
        cursor: "#d4a24c",
        selectionBackground: "rgba(62, 207, 142, 0.28)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(getWsUrl("/ws/ssh"));
    wsRef.current = ws;

    ws.onopen = () => {
      const auth =
        server.authMethod === "password"
          ? { method: "password" as const, password: server.password ?? "" }
          : {
              method: "privateKey" as const,
              privateKey: server.privateKey ?? "",
              passphrase: server.passphrase,
            };

      const payload: ConnectRequest = {
        type: "connect",
        host: server.host,
        port: server.port,
        username: server.username,
        auth,
        cols: term.cols,
        rows: term.rows,
        term: "xterm-256color",
      };
      ws.send(JSON.stringify(payload));
      term.writeln(`\x1b[38;2;212;162;76mOpenTerm\x1b[0m → ${server.username}@${server.host}:${server.port}`);
      term.writeln("Connecting…");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          data?: string;
          message?: string;
        };
        if (msg.type === "ready") {
          setStatus("live");
          term.writeln("\x1b[32mConnected.\x1b[0m\r\n");
          return;
        }
        if (msg.type === "data" && msg.data) {
          term.write(msg.data);
          return;
        }
        if (msg.type === "error") {
          setStatus("error");
          setError(msg.message ?? "SSH error");
          term.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`);
          return;
        }
        if (msg.type === "closed") {
          setStatus("closed");
          term.writeln("\r\n\x1b[33mSession closed.\x1b[0m");
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket error");
    };

    ws.onclose = () => {
      setStatus((prev) => (prev === "live" ? "closed" : prev));
    };

    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    const onResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(hostRef.current);

    return () => {
      disposable.dispose();
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "disconnect" }));
      }
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [server]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="session-bar">
        <span className="badge">
          <span className={`status-dot ${status === "live" ? "live" : status === "error" ? "err" : ""}`} />
          {status === "connecting" && "Подключение…"}
          {status === "live" && `${server.username}@${server.host}`}
          {status === "error" && (error ?? "Ошибка")}
          {status === "closed" && "Сессия закрыта"}
        </span>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => {
            wsRef.current?.send(JSON.stringify({ type: "disconnect" }));
            wsRef.current?.close();
          }}
        >
          Отключить
        </button>
      </div>
      <div className="terminal-wrap" ref={hostRef} />
    </div>
  );
}
