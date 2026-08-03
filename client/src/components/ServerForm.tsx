import { useEffect, useState, type FormEvent } from "react";
import { type AuthMethod, type ServerProfile, newServerId } from "../lib/vault";

type Props = {
  initial?: ServerProfile | null;
  onSave: (profile: ServerProfile) => void;
  onCancel: () => void;
};

export function ServerForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

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
  }, [initial]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const now = new Date().toISOString();
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
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h1>{initial ? "Редактировать сервер" : "Новый сервер"}</h1>
      <p className="lead">Учётные данные остаются только в зашифрованном vault на этом устройстве.</p>
      <div className="form-grid">
        <div className="form-row">
          <label htmlFor="name">Название</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-bastion" />
        </div>
        <div className="form-row two">
          <div className="form-row">
            <label htmlFor="host">Хост</label>
            <input id="host" value={host} onChange={(e) => setHost(e.target.value)} required />
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
          <label htmlFor="user">Пользователь</label>
          <input id="user" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="form-row">
          <label htmlFor="auth">Аутентификация</label>
          <select
            id="auth"
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
          >
            <option value="password">Пароль</option>
            <option value="privateKey">SSH-ключ</option>
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
              <label htmlFor="key">Приватный ключ</label>
              <textarea
                id="key"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </div>
            <div className="form-row">
              <label htmlFor="passphrase">Passphrase (если есть)</label>
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
        <div className="inline-actions">
          <button className="btn btn-primary" type="submit">
            Сохранить локально
          </button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </form>
  );
}
