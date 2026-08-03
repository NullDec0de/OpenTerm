import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { base64ToBytes, bytesToBase64 } from "../lib/base64";
import { formatBytes } from "../lib/format";
import type { ServerProfile } from "../lib/vault";
import { getWsUrl, type ConnectRequest } from "../lib/ws";
import { useToast } from "./Toast";

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
  const { showToast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const [status, setStatus] = useState<"connecting" | "live" | "error" | "closed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const request = useCallback(<T,>(payload: Record<string, unknown>) => {
    return new Promise<T>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Нет соединения с сервером"));
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
        if (!result.ok) throw new Error(result.error ?? "Не удалось получить список файлов");
        setPath(result.path ?? nextPath);
        setEntries(result.entries ?? []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ошибка SFTP";
        setError(msg);
        showToast(msg, "error");
      } finally {
        setBusy(false);
      }
    },
    [request, showToast],
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
          setError(msg.message ?? "Ошибка SFTP");
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
      setError("WebSocket ошибка");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "disconnect" }));
      }
      ws.close();
      pendingRef.current.forEach((p) => p.reject(new Error("Закрыто")));
      pendingRef.current.clear();
      wsRef.current = null;
    };
  }, [server, loadDir]);

  const breadcrumbs = useMemo(() => {
    if (!path || path === ".") return [{ name: "root", path: "." }];
    const parts = path.split("/").filter(Boolean);
    const crumbs = [{ name: "/", path: "/" }];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : `/${part}`;
      crumbs.push({ name: part, path: acc });
    }
    return crumbs;
  }, [path]);

  const filteredEntries = useMemo(() => {
    if (!filter.trim()) return entries;
    const term = filter.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(term));
  }, [entries, filter]);

  const uploadFile = async (file: File) => {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength > 8 * 1024 * 1024) {
        throw new Error("Файл больше 8MB");
      }
      const contentBase64 = bytesToBase64(new Uint8Array(buffer));
      const target = path === "." || path === "/" ? file.name : `${path}/${file.name}`;
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:upload",
        path: target,
        contentBase64,
      });
      if (!result.ok) throw new Error(result.error ?? "Ошибка загрузки файла");
      showToast(`Загружен: ${file.name}`, "success");
      await loadDir(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка загрузки";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0]) {
      void uploadFile(files[0]);
    }
  };

  const downloadFile = async (entry: Entry) => {
    setBusy(true);
    try {
      const result = await request<{
        ok: boolean;
        error?: string;
        contentBase64?: string;
      }>({ type: "sftp:download", path: entry.path });
      if (!result.ok || !result.contentBase64) throw new Error(result.error ?? "Ошибка скачивания");
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
      showToast(`Скачан: ${entry.name}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка скачивания";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    const name = window.prompt("Имя новой папки");
    if (!name) return;
    setBusy(true);
    try {
      const target = path === "." || path === "/" ? name : `${path}/${name}`;
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:mkdir",
        path: target,
      });
      if (!result.ok) throw new Error(result.error ?? "Не удалось создать папку");
      showToast(`Создана папка: ${name}`, "success");
      await loadDir(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка mkdir";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entry: Entry) => {
    if (!window.confirm(`Удалить ${entry.isDirectory ? "папку" : "файл"} ${entry.name}?`)) return;
    setBusy(true);
    try {
      const result = await request<{ ok: boolean; error?: string }>({
        type: "sftp:delete",
        path: entry.path,
        isDir: entry.isDirectory,
      });
      if (!result.ok) throw new Error(result.error ?? "Ошибка удаления");
      showToast(`Удалено: ${entry.name}`, "success");
      await loadDir(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка удаления";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sftp-wrap">
      <div className="sftp-toolbar">
        <div className="status-badge">
          <span className={`status-dot ${status === "live" ? "live" : status === "error" ? "err" : ""}`} />
          <span>SFTP {status}</span>
        </div>

        <div className="sftp-breadcrumbs">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path} style={{ display: "inline-flex", alignItems: "center" }}>
              {idx > 0 && <span style={{ color: "var(--subtle)", margin: "0 0.15rem" }}>/</span>}
              <button
                className={`crumb-btn ${crumb.path === path ? "active" : ""}`}
                type="button"
                onClick={() => loadDir(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <input
            style={{ width: "160px", padding: "0.35rem 0.6rem", fontSize: "0.8rem" }}
            placeholder="Фильтр файлов..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || status !== "live"}
            onClick={() => loadDir(path)}
          >
            Обновить
          </button>
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || status !== "live"}
            onClick={createFolder}
          >
            + Папка
          </button>
          <label className={`btn btn-sm ${busy ? "disabled" : ""}`}>
            Загрузить
            <input
              type="file"
              hidden
              disabled={busy || status !== "live"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && <div className="toast toast-error" style={{ margin: "0.5rem 1rem 0" }}>{error}</div>}

      <div
        className="sftp-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && <div className="sftp-drop-overlay">Перетащите файл для загрузки в {path}</div>}

        <table className="sftp-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th style={{ width: "120px" }}>Размер</th>
              <th style={{ width: "160px" }}>Изменён</th>
              <th style={{ width: "140px", textAlign: "right" }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map((entry) => (
              <tr key={entry.path}>
                <td>
                  <div className="sftp-name-cell">
                    <span className={`file-icon ${entry.isDirectory ? "dir" : ""}`}>
                      {entry.isDirectory ? "📁" : "📄"}
                    </span>
                    {entry.isDirectory ? (
                      <button
                        className="crumb-btn active"
                        type="button"
                        onClick={() => loadDir(entry.path)}
                      >
                        {entry.name}
                      </button>
                    ) : (
                      <span>{entry.name}</span>
                    )}
                  </div>
                </td>
                <td>{entry.isDirectory ? "—" : formatBytes(entry.size)}</td>
                <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  {entry.modifyTime ? new Date(entry.modifyTime).toLocaleString() : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: "0.3rem" }}>
                    {!entry.isDirectory && (
                      <button className="btn btn-sm" type="button" onClick={() => downloadFile(entry)}>
                        Скачать
                      </button>
                    )}
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteEntry(entry)}>
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!filteredEntries.length && (
              <tr>
                <td colSpan={4}>
                  <div className="empty-state">
                    <div className="empty-icon">{busy ? "⏳" : "📂"}</div>
                    <div>{busy ? "Загрузка файловой системы..." : "Ничего не найдено"}</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
