import { useState, type FormEvent } from "react";

type Props = {
  hasVault: boolean;
  onUnlock: (password: string) => Promise<void>;
  onCreate: (password: string) => Promise<void>;
  onImportFile: () => void;
  onImportQr: () => void;
};

export function LockScreen({ hasVault, onUnlock, onCreate, onImportFile, onImportQr }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (hasVault) {
        await onUnlock(password);
      } else {
        if (password.length < 8) {
          throw new Error("Мастер-пароль должен быть не короче 8 символов");
        }
        if (password !== confirm) {
          throw new Error("Пароли не совпадают");
        }
        await onCreate(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка автокализации");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <form className="lock-panel" onSubmit={submit}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <div className="brand-icon">O</div>
          <div className="brand-title" style={{ fontSize: "1.6rem" }}>OpenTerm</div>
        </div>

        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.3rem" }}>
          {hasVault ? "Разблокируйте Vault" : "Создайте локальный Vault"}
        </h2>
        <p style={{ color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.45, margin: "0 0 1.5rem" }}>
          Все пароли и ключи шифруются локально (AES-GCM). Сервер OpenTerm работает без базы данных и никогда не хранит секреты.
        </p>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="master">Мастер-пароль</label>
            <input
              id="master"
              type="password"
              autoComplete={hasVault ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          {!hasVault && (
            <div className="form-row">
              <label htmlFor="confirm">Подтвердите пароль</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </div>
          )}

          {error && <div className="toast toast-error">{error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.5rem" }}>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
              {busy ? "Обработка..." : hasVault ? "Открыть Vault" : "Создать зашифрованный Vault"}
            </button>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-ghost" type="button" onClick={onImportFile} style={{ flex: 1, justifyContent: "center" }}>
                Импорт файла
              </button>
              <button className="btn btn-ghost" type="button" onClick={onImportQr} style={{ flex: 1, justifyContent: "center" }}>
                Импорт QR
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
