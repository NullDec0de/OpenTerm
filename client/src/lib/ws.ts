export function getWsUrl(path: "/ws/ssh" | "/ws/sftp"): string {
  const configured = import.meta.env.VITE_WS_BASE;
  if (configured) {
    return `${configured.replace(/\/$/, "")}${path}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export type AuthPayload =
  | { method: "password"; password: string }
  | { method: "privateKey"; privateKey: string; passphrase?: string };

export type ConnectRequest = {
  type: "connect";
  host: string;
  port?: number;
  username: string;
  auth: AuthPayload;
  cols?: number;
  rows?: number;
  term?: string;
};
