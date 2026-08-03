import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bytesToBase64, base64ToBytes } from "../lib/base64";
import { formatBytes, parentPath } from "../lib/format";
import type { ServerProfile } from "../lib/vault";
import { getWsUrl, type ConnectRequest } from "../lib/ws";

type Entry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
};

type Props = {
  server: ServerProfile;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export function SftpSession({ server }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  const request = useCallback(<T,>(payload: Record<string, unknown>) => {
    return new Promise<T>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }
      const requestId = crypto.randomUUID();
      pendingRef.current.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      ws.send(JSON.stringify({ ...payload, requestId }));
    });
  }, []);

  const loadDir = useCallback(
    async (nextPath: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await request<{
          ok: boolean;
          error?: string;
          entries?: Entry[];
          path?: string;
        }>({ type: "sftp:list", path: nextPath });
        if (!result.ok) throw new Error(result.error ?? "List failed");
        setPath(result.path ?? nextPath);
        setEntries(result.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "SFTP error");
      } finally {
        setBusy(false);
      }
    },
    [request],
  );

  useEffect(() => {
    const ws = new WebSocket(getWsUrl("/ws/sftp"));
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
      };
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          message?: string;
          requestId?: string;
          ok?: boolean;
          error?: string;
          entries?: Entry[];
          contentBase64?: string;
          path?: string;
        };

        if (msg.type === "ready") {
          setStatus("live");
          void loadDir(".");
          return;
        }
        if (msg.type === "error") {
          setStatus("error");
          setError(msg.message ?? "SFTP error");
          return;
        }
        if (msg.type === "closed") {
          setStatus("closed");
          return;
        }
        if (msg.type === "sftp:result" && msg.requestId) {
          const pending = pendingRef.current.get(msg.requestId);
          if (!pending) return;
          pendingRef.current.delete(msg.requestId);
          pending.resolve(msg);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket error");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "disconnect" }));
      }
      ws.close();
      pendingRef.current.forEach((p) => p.reject(new Error("closed")));
      pendingRef.current.clear();
      wsRef.current = null;
    };
  }, [server, loadDir]);

  const sorted = useMemo(() => entries, [entries]);

  const download = async (entry: Entry) => {
    setBusy(true);
    try {
      const result = await request<{
        ok: boolean;
        error?: string;
        contentBase64?: string;
      }>({ type: "sftp:download", path: entry.path });
      if (!result.ok || !result.contentBase64) throw new Error(result.error ?? "Download failed");
      const bytes = base64ToBytes(result.contentBase64);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const blob = new Blob([copy]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download error");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > 8 * 1024 * 1024) {
        throw new Error("Файл больше 8MB");
      }
      const contentBase64 = bytesToBase64(new Uint8Array(buffer));
      const target = path.endsWith("/") ? `${path}${file.name}` : `${path}/${file.name}`;
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:upload",
        path: target,
        contentBase64,
      });
      if (!result.ok) throw new Error(result.error ?? "Upload failed");
      await loadDir(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload error");
    } finally {
      setBusy(false);
    }
  };

  const mkdir = async () => {
    const name = window.prompt("Имя папки");
    if (!name) return;
    setBusy(true);
    try {
      const target = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:mkdir",
        path: target,
      });
      if (!result.ok) throw new Error(result.error ?? "mkdir failed");
      await loadDir(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "mkdir error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: Entry) => {
    if (!window.confirm(`Удалить ${entry.name}?`)) return;
    setBusy(true);
    try {
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:delete",
        path: entry.path,
        isDir: entry.isDirectory,
      });
      if (!result.ok) throw new Error(result.error ?? "delete failed");
      await loadDir(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sftp-wrap">
      <div className="sftp-toolbar">
        <span className="badge">
          <span className={`status-dot ${status === "live" ? "live" : status === "error" ? "err" : ""}`} />
          SFTP {status === "live" ? "online" : status}
        </span>
        <span className="sftp-path">{path}</span>
        <button className="btn" type="button" disabled={busy || status !== "live"} onClick={() => loadDir(parentPath(path))}>
          Вверх
        </button>
        <button className="btn" type="button" disabled={busy || status !== "live"} onClick={() => loadDir(path)}>
          Обновить
        </button>
        <button className="btn" type="button" disabled={busy || status !== "live"} onClick={mkdir}>
          Папка
        </button>
        <label className="btn" style={{ display: "inline-flex", alignItems: "center" }}>
          Загрузить
          <input
            type="file"
            hidden
            disabled={busy || status !== "live"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="error-text" style={{ padding: "0.5rem 1rem" }}>{error}</p>}
      <div style={{ overflow: "auto" }}>
        <table className="sftp-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Размер</th>
              <th>Изменён</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr key={entry.path}>
                <td>
                  {entry.isDirectory ? (
                    <button className="linkish" type="button" onClick={() => loadDir(entry.path)}>
                      [dir] {entry.name}
                    </button>
                  ) : (
                    <span style={{ fontFamily: "var(--font-mono)" }}>{entry.name}</span>
                  )}
                </td>
                <td>{entry.isDirectory ? "—" : formatBytes(entry.size)}</td>
                <td>{entry.modifyTime ? new Date(entry.modifyTime).toLocaleString() : "—"}</td>
                <td>
                  <div className="inline-actions">
                    {!entry.isDirectory && (
                      <button className="btn" type="button" onClick={() => download(entry)}>
                        Скачать
                      </button>
                    )}
                    <button className="btn btn-danger" type="button" onClick={() => remove(entry)}>
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={4} className="empty">
                  {busy ? "Загрузка…" : "Пусто"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
