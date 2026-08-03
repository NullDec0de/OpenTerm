import { useEffect, useState, type FormEvent } from "react";
import { type AuthMethod, type ServerProfile, newServerId } from "../lib/vault";

type Props = {
  initial?: ServerProfile | null;
  onSave: (profile: ServerProfile) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
};

const COLOR_OPTIONS = ["#e5b054", "#3ecf8e", "#54a0ff", "#a855f7", "#ff6b6b"];

export function ServerForm({ initial, onSave, onDelete, onCancel }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [color, setColor] = useState(COLOR_OPTIONS[0]);

  useEffect(() => {
    if (!initial) {
      setName("");
      setHost("");
      setPort(22);
      setUsername("");
      setAuthMethod("password");
      setPassword("");
      setPrivateKey("");
      setPassphrase("");
      setTagsInput("");
      setColor(COLOR_OPTIONS[0]);
      return;
    }
    setName(initial.name);
    setHost(initial.host);
    setPort(initial.port);
    setUsername(initial.username);
    setAuthMethod(initial.authMethod);
    setPassword(initial.password ?? "");
    setPrivateKey(initial.privateKey ?? "");
    setPassphrase(initial.passphrase ?? "");
    setTagsInput(initial.tags?.join(", ") ?? "");
    setColor(initial.color ?? COLOR_OPTIONS[0]);
  }, [initial]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    onSave({
      id: initial?.id ?? newServerId(),
      name: name.trim() || host.trim(),
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      authMethod,
      password: authMethod === "password" ? password : undefined,
      privateKey: authMethod === "privateKey" ? privateKey : undefined,
      passphrase: authMethod === "privateKey" ? passphrase || undefined : undefined,
      tags,
      color,
      isFavorite: initial?.isFavorite ?? false,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h1 className="panel-title">{initial ? "Настройка сервера" : "Новый сервер"}</h1>
        <p className="panel-subtitle">
          Данные шифруются мастер-паролем на вашем устройстве.
        </p>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label htmlFor="name">Название соединения</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production Bastion"
          />
        </div>

        <div className="form-row two">
          <div className="form-row">
            <label htmlFor="host">IP / Хост</label>
            <input
              id="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.1 или server.com"
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="port">Порт</label>
            <input
              id="port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="user">Имя пользователя SSH</label>
          <input
            id="user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="root / ubuntu / admin"
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="auth">Способ авторизации</label>
          <select
            id="auth"
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
          >
            <option value="password">Пароль</option>
            <option value="privateKey">Приватный SSH-ключ</option>
          </select>
        </div>

        {authMethod === "password" ? (
          <div className="form-row">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </div>
        ) : (
          <>
            <div className="form-row">
              <label htmlFor="key">Приватный ключ (RSA / Ed25519 / OpenSSH)</label>
              <textarea
                id="key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </div>
            <div className="form-row">
              <label htmlFor="passphrase">Passphrase к ключу (если есть)</label>
              <input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <div className="form-row">
          <label htmlFor="tags">Теги (через запятую)</label>
          <input
            id="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="prod, web, database, staging"
          />
        </div>

        <div className="form-row">
          <label>Метка цвета</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  backgroundColor: c,
                  border: color === c ? "2px solid #fff" : "none",
                  cursor: "pointer",
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn btn-primary" type="submit">
              Сохранить в Vault
            </button>
            <button className="btn btn-ghost" type="button" onClick={onCancel}>
              Отмена
            </button>
          </div>
          {initial && onDelete && (
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => {
                if (window.confirm(`Удалить сервер ${initial.name}?`)) {
                  onDelete(initial.id);
                }
              }}
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
