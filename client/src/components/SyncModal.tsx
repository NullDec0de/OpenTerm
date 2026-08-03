import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { parseChunk, splitPayload, wrapChunk } from "../lib/crypto";
import {
  exportCompactPayload,
  exportEncryptedVault,
  importCompactPayload,
  importEncryptedVault,
  type VaultData,
  type VaultExportFile,
} from "../lib/vault";

type Mode = "export" | "import-file" | "import-qr";

type Props = {
  mode: Mode;
  masterPassword: string | null;
  onClose: () => void;
  onImported: (vault: VaultData, password: string) => void;
};

export function SyncModal({ mode, masterPassword, onClose, onImported }: Props) {
  const [password, setPassword] = useState(masterPassword ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [chunks, setChunks] = useState<string[]>([]);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [received, setReceived] = useState<Map<number, string>>(new Map());
  const [expected, setExpected] = useState<number | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanBoxId = "openterm-qr-reader";

  const title = useMemo(() => {
    if (mode === "export") return "Экспорт vault";
    if (mode === "import-file") return "Импорт из файла";
    return "Импорт по QR";
  }, [mode]);

  useEffect(() => {
    if (mode !== "export" || !masterPassword) return;
    let cancelled = false;
    (async () => {
      try {
        const compact = await exportCompactPayload(masterPassword);
        const parts = splitPayload(compact, 700).map((_, i, arr) => wrapChunk(arr, i));
        if (cancelled) return;
        setChunks(parts);
        setChunkIndex(0);
        setInfo(
          parts.length > 1
            ? `Vault разбит на ${parts.length} QR-чанков. Листайте и сканируйте по порядку.`
            : "Один QR содержит весь зашифрованный vault.",
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Export failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, masterPassword]);

  useEffect(() => {
    if (!chunks.length) return;
    let cancelled = false;
    QRCode.toDataURL(chunks[chunkIndex]!, { width: 320, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [chunks, chunkIndex]);

  useEffect(() => {
    if (mode !== "import-qr") return;
    const scanner = new Html5Qrcode(scanBoxId);
    scannerRef.current = scanner;
    let stopped = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 8, qrbox: 240 },
        (decoded) => {
          try {
            const chunk = parseChunk(decoded);
            setExpected(chunk.n);
            setReceived((prev) => {
              if (prev.get(chunk.i) === chunk.d) return prev;
              const next = new Map(prev);
              next.set(chunk.i, chunk.d);
              setInfo(`Получено чанков: ${next.size}/${chunk.n}`);
              return next;
            });
          } catch {
            // Maybe a whole compact payload without chunk wrapper.
            if (decoded.startsWith("OT1.")) {
              setReceived(new Map([[0, decoded]]));
              setExpected(1);
              setInfo("Получен полный payload");
            }
          }
        },
        () => undefined,
      )
      .catch((err: Error) => {
        if (!stopped) setError(err.message || "Не удалось открыть камеру");
      });

    return () => {
      stopped = true;
      void scanner
        .stop()
        .catch(() => undefined)
        .finally(() => {
          try {
            scanner.clear();
          } catch {
            /* ignore */
          }
        });
      scannerRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "import-qr" || expected == null) return;
    if (received.size < expected) return;
    const ordered: string[] = [];
    for (let i = 0; i < expected; i += 1) {
      const part = received.get(i);
      if (!part) return;
      ordered.push(part);
    }
    const payload = ordered.join("");
    (async () => {
      try {
        if (!password) {
          setError("Введите мастер-пароль vault");
          return;
        }
        const vault = await importCompactPayload(payload, password);
        onImported(vault, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    })();
  }, [mode, expected, received, password, onImported]);

  const downloadFile = async () => {
    if (!masterPassword) return;
    setError(null);
    try {
      const file = await exportEncryptedVault(masterPassword);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openterm-vault-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setInfo("Файл скачан. Храните его вместе с мастер-паролем.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const onFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const input = form.elements.namedItem("vaultfile") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError("Выберите файл");
      return;
    }
    if (!password) {
      setError("Введите мастер-пароль");
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as VaultExportFile;
      const vault = await importEncryptedVault(parsed, password);
      onImported(vault, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{title}</h2>
        <p className="sub">
          Секреты остаются зашифрованными. OpenTerm-сервер не участвует в синхронизации vault.
        </p>

        {(mode === "import-file" || mode === "import-qr") && (
          <div className="form-row" style={{ marginBottom: "0.85rem" }}>
            <label htmlFor="sync-pass">Мастер-пароль vault</label>
            <input
              id="sync-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        )}

        {mode === "export" && (
          <>
            <div className="inline-actions" style={{ marginBottom: "1rem" }}>
              <button className="btn btn-primary" type="button" onClick={downloadFile}>
                Скачать файл
              </button>
            </div>
            {qrDataUrl && (
              <div className="qr-box">
                <img src={qrDataUrl} alt={`QR chunk ${chunkIndex + 1}`} />
                {chunks.length > 1 && (
                  <div className="chunk-nav">
                    <button
                      className="btn"
                      type="button"
                      disabled={chunkIndex === 0}
                      onClick={() => setChunkIndex((v) => Math.max(0, v - 1))}
                    >
                      Назад
                    </button>
                    <span>
                      {chunkIndex + 1} / {chunks.length}
                    </span>
                    <button
                      className="btn"
                      type="button"
                      disabled={chunkIndex >= chunks.length - 1}
                      onClick={() => setChunkIndex((v) => Math.min(chunks.length - 1, v + 1))}
                    >
                      Далее
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {mode === "import-file" && (
          <form className="form-grid" onSubmit={onFile}>
            <div className="form-row">
              <label htmlFor="vaultfile">Файл OpenTerm vault</label>
              <input id="vaultfile" name="vaultfile" type="file" accept="application/json,.json" />
            </div>
            <div className="inline-actions">
              <button className="btn btn-primary" type="submit">
                Импортировать
              </button>
            </div>
          </form>
        )}

        {mode === "import-qr" && (
          <div>
            <div id={scanBoxId} className="scanner" />
            <p className="hint">Наведите камеру на QR с другого устройства.</p>
          </div>
        )}

        {info && <p className="hint">{info}</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="inline-actions" style={{ marginTop: "1rem" }}>
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
