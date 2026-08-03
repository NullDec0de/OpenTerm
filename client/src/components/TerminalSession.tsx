import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
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
    /* ignore */
  }
}

export function TerminalSession({ server }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const clearTerminal = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const copySelection = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) {
      void navigator.clipboard.writeText(sel);
    }
  }, []);

  const pasteClipboard = useCallback(() => {
    void navigator.clipboard.readText().then((text) => {
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "data", data: text }));
      }
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"IBM Plex Mono", Consolas, monospace',
      fontSize,
      theme: {
        background: "#050a08",
        foreground: "#e8f2ec",
        cursor: "#e5b054",
        selectionBackground: "rgba(62, 207, 142, 0.3)",
        black: "#000000",
        red: "#ff6b6b",
        green: "#3ecf8e",
        yellow: "#e5b054",
        blue: "#54a0ff",
        magenta: "#a855f7",
        cyan: "#00d2d3",
        white: "#e8f2ec",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);

    termRef.current = term;
    fitRef.current = fit;

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
        `\x1b[38;2;229;176;84mOpenTerm\x1b[0m SSH Session → \x1b[1m${server.username}@${server.host}:${server.port}\x1b[0m`,
      );
      term.writeln("Connecting…\r\n");
    };

    ws.onopen = () => {
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
          term.writeln("\x1b[32m✔ Connected to SSH server\x1b[0m\r\n");
          return;
        }
        if (msg.type === "data" && msg.data) {
          term.write(msg.data);
          return;
        }
        if (msg.type === "error") {
          setStatus("error");
          setError(msg.message ?? "SSH Error");
          term.writeln(`\r\n\x1b[31m✖ Error: ${msg.message}\x1b[0m`);
          return;
        }
        if (msg.type === "closed") {
          setStatus("closed");
          term.writeln("\r\n\x1b[33m⚡ Session closed\x1b[0m");
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket connection failed");
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
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [server, fontSize]);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
    setTimeout(() => {
      if (fitRef.current && hostRef.current) {
        safeFit(fitRef.current, hostRef.current);
      }
    }, 100);
  };

  return (
    <div
      className="session-container"
      style={
        isFullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 90,
              background: "#050a08",
            }
          : undefined
      }
    >
      <div className="session-toolbar">
        <div className="status-badge">
          <span
            className={`status-dot ${status === "live" ? "live" : status === "error" ? "err" : ""}`}
          />
          <span>
            {status === "connecting" && "Подключение..."}
            {status === "live" && `${server.username}@${server.host}:${server.port}`}
            {status === "error" && (error ?? "Ошибка")}
            {status === "closed" && "Сессия завершена"}
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button className="btn btn-sm" type="button" onClick={clearTerminal} title="Очистить экран">
            Очистить
          </button>
          <button className="btn btn-sm" type="button" onClick={copySelection} title="Скопировать выделение">
            Копия
          </button>
          <button className="btn btn-sm" type="button" onClick={pasteClipboard} title="Вставить из буфера">
            Вставить
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", margin: "0 0.2rem" }}>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            >
              A-
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => setFontSize((s) => Math.min(22, s + 1))}
            >
              A+
            </button>
          </div>

          <button className="btn btn-sm" type="button" onClick={toggleFullscreen}>
            {isFullscreen ? "Свернуть" : "Полноэкранный"}
          </button>

          <button
            className="btn btn-sm btn-danger"
            type="button"
            onClick={() => {
              wsRef.current?.send(JSON.stringify({ type: "disconnect" }));
              wsRef.current?.close();
            }}
          >
            Отключить
          </button>
        </div>
      </div>

      <div className="terminal-wrap" ref={hostRef} />
    </div>
  );
}
