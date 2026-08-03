import { useCallback, useMemo, useState } from "react";
import { LockScreen } from "./components/LockScreen";
import { ServerForm } from "./components/ServerForm";
import { SftpSession } from "./components/SftpSession";
import { SyncModal } from "./components/SyncModal";
import { TerminalSession } from "./components/TerminalSession";
import {
  createVault,
  persistVault,
  readVaultMeta,
  removeServer,
  unlockVault,
  upsertServer,
  type ServerProfile,
  type VaultData,
} from "./lib/vault";

type View =
  | { kind: "welcome" }
  | { kind: "edit"; server?: ServerProfile | null }
  | { kind: "session"; serverId: string; tab: "ssh" | "sftp" };

type SyncState =
  | null
  | { mode: "export" }
  | { mode: "import-file" }
  | { mode: "import-qr" };

export default function App() {
  const meta = useMemo(() => readVaultMeta(), []);
  const [hasVault, setHasVault] = useState(meta.hasVault);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "welcome" });
  const [sync, setSync] = useState<SyncState>(null);

  const selected = vault?.servers.find((s) => s.id === selectedId) ?? null;

  const saveVault = useCallback(
    async (next: VaultData, password = masterPassword) => {
      if (!password) throw new Error("Vault is locked");
      await persistVault(next, password);
      setVault(next);
      setHasVault(true);
    },
    [masterPassword],
  );

  if (!vault || !masterPassword) {
    return (
      <>
        <LockScreen
          hasVault={hasVault}
          onUnlock={async (password) => {
            const data = await unlockVault(password);
            setVault(data);
            setMasterPassword(password);
            setHasVault(true);
          }}
          onCreate={async (password) => {
            const data = await createVault(password);
            setVault(data);
            setMasterPassword(password);
            setHasVault(true);
          }}
          onImportFile={() => setSync({ mode: "import-file" })}
          onImportQr={() => setSync({ mode: "import-qr" })}
        />
        {sync && (
          <SyncModal
            mode={sync.mode}
            masterPassword={masterPassword}
            onClose={() => setSync(null)}
            onImported={(data, password) => {
              setVault(data);
              setMasterPassword(password);
              setHasVault(true);
              setSync(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">OpenTerm</div>
          <div className="brand-tag">SSH / SFTP · vault only on device</div>
        </div>
        <div className="top-actions">
          <button className="btn" type="button" onClick={() => setSync({ mode: "export" })}>
            Синхронизация
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setVault(null);
              setMasterPassword(null);
              setView({ kind: "welcome" });
              setSelectedId(null);
            }}
          >
            Заблокировать
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Серверы</h2>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                setSelectedId(null);
                setView({ kind: "edit", server: null });
              }}
            >
              +
            </button>
          </div>
          <div className="server-list">
            {vault.servers.map((server) => (
              <button
                key={server.id}
                type="button"
                className={`server-item ${selectedId === server.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedId(server.id);
                  setView({ kind: "session", serverId: server.id, tab: "ssh" });
                }}
              >
                <strong>{server.name}</strong>
                <span>
                  {server.username}@{server.host}:{server.port}
                </span>
              </button>
            ))}
            {!vault.servers.length && (
              <div className="empty">Пока пусто. Добавьте первый сервер — секреты останутся локально.</div>
            )}
          </div>
        </aside>

        <main className="main">
          {view.kind === "welcome" && (
            <section className="panel">
              <h1>Локальный SSH/SFTP клиент</h1>
              <p className="lead">
                Подключайтесь к серверам из браузера. Пароли и ключи шифруются мастер-паролем и
                живут только в браузере. Синхронизация — файлом или QR между вашими устройствами.
              </p>
              <div className="inline-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setView({ kind: "edit", server: null })}
                >
                  Добавить сервер
                </button>
                <button className="btn" type="button" onClick={() => setSync({ mode: "export" })}>
                  Экспорт / QR
                </button>
              </div>
            </section>
          )}

          {view.kind === "edit" && (
            <ServerForm
              initial={view.server ?? null}
              onCancel={() => setView({ kind: "welcome" })}
              onSave={async (profile) => {
                const next = upsertServer(vault, profile);
                await saveVault(next);
                setSelectedId(profile.id);
                setView({ kind: "session", serverId: profile.id, tab: "ssh" });
              }}
            />
          )}

          {view.kind === "session" && selected && (
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", flex: 1, overflow: "hidden" }}>
              <div className="session-bar">
                <div className="tabs">
                  <button
                    type="button"
                    className={`tab ${view.tab === "ssh" ? "active" : ""}`}
                    onClick={() => setView({ kind: "session", serverId: selected.id, tab: "ssh" })}
                  >
                    SSH
                  </button>
                  <button
                    type="button"
                    className={`tab ${view.tab === "sftp" ? "active" : ""}`}
                    onClick={() => setView({ kind: "session", serverId: selected.id, tab: "sftp" })}
                  >
                    SFTP
                  </button>
                </div>
                <div className="inline-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setView({ kind: "edit", server: selected })}
                  >
                    Изменить
                  </button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Удалить ${selected.name}?`)) return;
                      const next = removeServer(vault, selected.id);
                      await saveVault(next);
                      setSelectedId(null);
                      setView({ kind: "welcome" });
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
              {view.tab === "ssh" ? (
                <TerminalSession server={selected} />
              ) : (
                <SftpSession server={selected} />
              )}
            </div>
          )}
        </main>
      </div>

      {sync && (
        <SyncModal
          mode={sync.mode}
          masterPassword={masterPassword}
          onClose={() => setSync(null)}
          onImported={async (data, password) => {
            setMasterPassword(password);
            await saveVault(data, password);
            setSync(null);
            setView({ kind: "welcome" });
          }}
        />
      )}
    </div>
  );
}
