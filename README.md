# OpenTerm

SSH/SFTP web client with local secret storage.

## Security Principle

- Passwords and private keys are not stored on the server.
- On the device, they are stored in an encrypted vault (`localStorage`) under a master password (AES-256-GCM, PBKDF2).
- The backend only accepts credentials in the memory of a live WebSocket session and immediately forgets them after closing.
- Synchronization between devices is via an **encrypted file** or **QR** (with chunks for large vaults).

## Stack

- Client: React + Vite + xterm.js
- Server: Node.js + Express + `ws` + `ssh2`

## Launch

```bash
npm install
npm run dev
```

- UI: http://localhost:5173
- API/WS: http://localhost:8787

## Production

```bash
npm run build
CLIENT_ORIGIN=https://your-domain npm start
```

The server serves API/`/ws/*`. Client statics can be served via any reverse proxy (or connect `express.static` to `client/dist`).

## Synchronization

1. **File** — "Synchronization" → download JSON. On another device: import file + master password.
2. **QR** — the export shows one or more QR chunks. On the second device: "Import QR" and scan.

## Important

OpenTerm server is an **SSH/SFTP relay**. Deploy it on a trusted machine (preferably self-hosted) and use HTTPS/WSS.
