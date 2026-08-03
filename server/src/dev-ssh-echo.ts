/**
 * Tiny local SSH shell for manual demos.
 * Run: npm run demo-ssh -w server
 */
import { generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";

const { Server } = ssh2;

const PORT = Number(process.env.DEMO_SSH_PORT ?? 2222);
const USER = process.env.DEMO_SSH_USER ?? "demo";
const PASS = process.env.DEMO_SSH_PASS ?? "demopass";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

const server = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on("authentication", (ctx) => {
    if (ctx.method === "password" && ctx.username === USER && ctx.password === PASS) {
      ctx.accept();
      return;
    }
    ctx.reject(["password"]);
  });

  client.on("ready", () => {
    client.on("session", (accept) => {
      const session = accept();
      session.on("pty", (acceptPty) => acceptPty());
      session.on("shell", (acceptShell) => {
        const stream = acceptShell();
        stream.write("\r\nWelcome to OpenTerm demo SSH\r\n$ ");
        let line = "";
        stream.on("data", (data: Buffer) => {
          const text = data.toString("utf8");
          for (const ch of text) {
            if (ch === "\r" || ch === "\n") {
              stream.write("\r\n");
              const cmd = line.trim();
              line = "";
              if (cmd === "exit") {
                stream.write("bye\r\n");
                stream.close();
                return;
              }
              if (cmd === "help") stream.write("commands: help, whoami, exit\r\n");
              else if (cmd === "whoami") stream.write(`${USER}\r\n`);
              else if (cmd) stream.write(`demo: unknown command '${cmd}'\r\n`);
              stream.write("$ ");
            } else if (ch === "\u007f") {
              if (line.length) {
                line = line.slice(0, -1);
                stream.write("\b \b");
              }
            } else {
              line += ch;
              stream.write(ch);
            }
          }
        });
      });
    });
  });
});

server.listen(PORT, "127.0.0.1", function onListen() {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`Demo SSH listening on 127.0.0.1:${port}`);
  console.log(`Login: ${USER} / ${PASS}`);
});
