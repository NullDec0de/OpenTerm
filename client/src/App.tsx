import { useCallback, useMemo, useState } from "react";
import { LockScreen } from "./components/LockScreen";
import { ServerForm } from "./components/ServerForm";
import { SftpSession } from "./components/SftpSession";
import { SyncModal } from "./components/SyncModal";
import { TerminalSession } from "./components/TerminalSession";
import { ToastProvider, useToast } from "./components/Toast";
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
  | { kind: "edit"; server?: ServerProfile | null };

type ActiveTab = {
  id: string; // unique tab id
  serverId: string;
  mode: "ssh" | "sftp";
};

type SyncState =
  | null
  | { mode: "export" }
  | { mode: "import-file" }
  | { mode: "import-qr" };

function MainApp() {
  const { showToast } = useToast();
  const meta = useMemo(() => readVaultMeta(), []);
  const [hasVault, setHasVault] = useState(meta.hasVault);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultData | null>(null);

  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const [view, setView] = useState<View>({ kind: "welcome" });
  const [tabs, setTabs] = useState<ActiveTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(null);

  const saveVault = useCallback(
    async (next: VaultData, password = masterPassword) => {
      if (!password) throw new Error("Vault заблокирован");
      await persistVault(next, password);
      setVault(next);
      setHasVault(true);
    },
    [masterPassword],
  );

  const allTags = useMemo(() => {
    if (!vault) return [];
    const set = new Set<string>();
    for (const s of vault.servers) {
      if (s.tags) {
        for (const t of s.tags) set.add(t);
      }
    }
    return Array.from(set).sort();
  }, [vault]);

  const filteredServers = useMemo(() => {
    if (!vault) return [];
    return vault.servers.filter((server) => {
      const matchesSearch =
        !search.trim() ||
        server.name.toLowerCase().includes(search.toLowerCase()) ||
        server.host.toLowerCase().includes(search.toLowerCase()) ||
        server.username.toLowerCase().includes(search.toLowerCase());

      const matchesTag = !selectedTag || (server.tags && server.tags.includes(selectedTag));

      return matchesSearch && matchesTag;
    });
  }, [vault, search, selectedTag]);

  const openSession = (serverId: string, mode: "ssh" | "sftp" = "ssh") => {
    const existing = tabs.find((t) => t.serverId === serverId && t.mode === mode);
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      const newTab: ActiveTab = { id: crypto.randomUUID(), serverId, mode };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.length ? next[next.length - 1]!.id : null);
      }
      return next;
    });
  };

  const toggleFavorite = async (server: ServerProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!vault) return;
    const updated = { ...server, isFavorite: !server.isFavorite };
    const nextVault = upsertServer(vault, updated);
    await saveVault(nextVault);
  };

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
            showToast("Vault разблокирован", "success");
          }}
          onCreate={async (password) => {
            const data = await createVault(password);
            setVault(data);
            setMasterPassword(password);
            setHasVault(true);
            showToast("Vault создан", "success");
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
              showToast("Vault импортирован", "success");
            }}
          />
        )}
      </>
    );
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeServer = activeTab ? vault.servers.find((s) => s.id === activeTab.serverId) : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">O</div>
          <div className="brand-title">OpenTerm</div>
          <div className="brand-tag">Device Vault</div>
        </div>

        <div className="top-actions">
          <button className="btn" type="button" onClick={() => setSync({ mode: "export" })}>
            Синхронизация (QR)
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setVault(null);
              setMasterPassword(null);
              setTabs([]);
              setActiveTabId(null);
            }}
          >
            Заблокировать
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="sidebar-title">Серверы ({filteredServers.length})</span>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => setView({ kind: "edit", server: null })}
            >
              + Сервер
            </button>
          </div>

          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              placeholder="Поиск серверов..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {allTags.length > 0 && (
            <div className="tag-pills">
              <button
                type="button"
                className={`tag-pill ${selectedTag === null ? "active" : ""}`}
                onClick={() => setSelectedTag(null)}
              >
                Все
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-pill ${selectedTag === tag ? "active" : ""}`}
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          <div className="server-list">
            {filteredServers.map((server) => (
              <div
                key={server.id}
                className={`server-card ${
                  activeServer?.id === server.id ? "active" : ""
                }`}
                onClick={() => openSession(server.id, "ssh")}
              >
                <div className="server-card-top">
                  <div className="server-card-name">
                    {server.color && (
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: server.color,
                          display: "inline-block",
                        }}
                      />
                    )}
                    {server.name}
                  </div>
                  <button
                    type="button"
                    className={`fav-star ${server.isFavorite ? "active" : ""}`}
                    onClick={(e) => void toggleFavorite(server, e)}
                  >
                    ★
                  </button>
                </div>

                <div className="server-card-meta">
                  {server.username}@{server.host}:{server.port}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.2rem" }}>
                  <div className="server-tags">
                    {server.tags?.map((t) => (
                      <span key={t} className="mini-tag">
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "0.2rem" }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      title="SSH Терминал"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSession(server.id, "ssh");
                      }}
                    >
                      SSH
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      title="SFTP Менеджер"
                      onClick={(e) => {
                        e.stopPropagation();
                        openSession(server.id, "sftp");
                      }}
                    >
                      SFTP
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!filteredServers.length && (
              <div className="empty-state">
                <div className="empty-icon">🖥️</div>
                <div>Серверы не найдены</div>
              </div>
            )}
          </div>
        </aside>

        <main className="main">
          {tabs.length > 0 && (
            <div className="workspace-tabs">
              {tabs.map((tab) => {
                const s = vault.servers.find((srv) => srv.id === tab.serverId);
                return (
                  <div
                    key={tab.id}
                    className={`ws-tab ${tab.id === activeTabId ? "active" : ""}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span>{tab.mode.toUpperCase()}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s?.name ?? "Сервер"}
                    </span>
                    <button
                      className="ws-tab-close"
                      type="button"
                      onClick={(e) => closeTab(tab.id, e)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab && activeServer ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {activeTab.mode === "ssh" ? (
                <TerminalSession key={activeTab.id} server={activeServer} />
              ) : (
                <SftpSession key={activeTab.id} server={activeServer} />
              )}
            </div>
          ) : view.kind === "edit" ? (
            <ServerForm
              initial={view.server ?? null}
              onCancel={() => setView({ kind: "welcome" })}
              onDelete={async (id) => {
                const next = removeServer(vault, id);
                await saveVault(next);
                setTabs((prev) => prev.filter((t) => t.serverId !== id));
                showToast("Сервер удален из Vault", "info");
                setView({ kind: "welcome" });
              }}
              onSave={async (profile) => {
                const next = upsertServer(vault, profile);
                await saveVault(next);
                showToast("Сервер сохранен в Vault", "success");
                openSession(profile.id, "ssh");
                setView({ kind: "welcome" });
              }}
            />
          ) : (
            <div className="panel">
              <div className="panel-header">
                <h1 className="panel-title">Продвинутый SSH & SFTP веб-клиент</h1>
                <p className="panel-subtitle">
                  Ваши данные зашифрованы и не покидают ваше устройство. Выберите сервер слева или добавьте новое подключение.
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setView({ kind: "edit", server: null })}
                >
                  + Добавить сервер
                </button>
                <button className="btn" type="button" onClick={() => setSync({ mode: "export" })}>
                  Экспорт в QR / Файл
                </button>
              </div>
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
            showToast("Синхронизация завершена", "success");
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <MainApp />
    </ToastProvider>
  );
}
