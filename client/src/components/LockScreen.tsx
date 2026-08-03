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
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <form className="lock-panel" onSubmit={submit}>
        <div className="brand-mark">OpenTerm</div>
        <h1>{hasVault ? "Разблокируйте хранилище" : "Создайте локальное хранилище"}</h1>
        <p className="sub">
          Пароли и ключи шифруются на этом устройстве. Сервер OpenTerm их не сохраняет — только
          проксирует живую SSH/SFTP-сессию в памяти.
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
              required
            />
          </div>
          {!hasVault && (
            <div className="form-row">
              <label htmlFor="confirm">Повтор пароля</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div className="inline-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "…" : hasVault ? "Открыть" : "Создать vault"}
            </button>
            <button className="btn" type="button" onClick={onImportFile}>
              Импорт файла
            </button>
            <button className="btn" type="button" onClick={onImportQr}>
              Импорт QR
            </button>
          </div>
        </div>
        <p className="hint">
          Синхронизация между устройствами — через зашифрованный файл или QR. Облачного бэкенда для
          секретов нет.
        </p>
      </form>
    </div>
  );
}
