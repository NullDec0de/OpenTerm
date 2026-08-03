export type AuthPayload =
  | {
      method: "password";
      password: string;
    }
  | {
      method: "privateKey";
      privateKey: string;
      passphrase?: string;
    };

export type ConnectPayload = {
  type: "connect";
  host: string;
  port?: number;
  username: string;
  auth: AuthPayload;
  cols?: number;
  rows?: number;
  term?: string;
};

export type ClientMessage =
  | ConnectPayload
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "disconnect" }
  | { type: "sftp:list"; path: string; requestId: string }
  | { type: "sftp:download"; path: string; requestId: string }
  | { type: "sftp:upload"; path: string; contentBase64: string; requestId: string }
  | { type: "sftp:mkdir"; path: string; requestId: string }
  | { type: "sftp:delete"; path: string; requestId: string; isDir?: boolean }
  | { type: "sftp:rename"; from: string; to: string; requestId: string };

export type ServerMessage =
  | { type: "ready"; banner?: string }
  | { type: "data"; data: string }
  | { type: "error"; message: string }
  | { type: "closed"; code?: number; signal?: string }
  | {
      type: "sftp:result";
      requestId: string;
      ok: boolean;
      error?: string;
      entries?: SftpEntry[];
      contentBase64?: string;
      path?: string;
    };

export type SftpEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  rights?: string;
};
