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

function safeFit(fit: FitAddon, el: HTMLElement | null) {
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  if (width < 20 || height < 20) return;
  try {
    fit.fit();
  } catch {
    /* xterm can throw during teardown */
  }
}

export function TerminalSession({ server }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
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
    term.open(host);

    const ws = new WebSocket(getWsUrl("/ws/ssh"));
    wsRef.current = ws;

    const connect = () => {
      if (disposed || ws.readyState !== WebSocket.OPEN) return;
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
      term.writeln(
        `\x1b[38;2;212;162;76mOpenTerm\x1b[0m → ${server.username}@${server.host}:${server.port}`,
      );
      term.writeln("Connecting…");
    };

    ws.onopen = () => {
      // Fit after layout paints so xterm viewport exists.
      requestAnimationFrame(() => {
        safeFit(fit, host);
        connect();
      });
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
          term.writeln("\x1b[32mConnected.\x1b[0m");
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
      safeFit(fit, host);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(host);
    requestAnimationFrame(() => safeFit(fit, host));

    return () => {
      disposed = true;
      disposable.dispose();
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "disconnect" }));
      }
      ws.close();
      term.dispose();
      wsRef.current = null;
    };
  }, [server]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: 1 }}>
      <div className="session-bar">
        <span className="badge">
          <span
            className={`status-dot ${status === "live" ? "live" : status === "error" ? "err" : ""}`}
          />
          {status === "connecting" && "Подключение…"}
          {status === "live" && `${server.username}@${server.host}:${server.port}`}
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
