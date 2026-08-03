const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type EncryptedBlob = {
  v: 1;
  salt: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i += 1) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson<T>(data: T, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = textEncoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    plaintext,
  );

  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptJson<T>(blob: EncryptedBlob, password: string): Promise<T> {
  if (blob.v !== 1) {
    throw new Error("Unsupported vault format");
  }
  const salt = fromBase64(blob.salt);
  const iv = fromBase64(blob.iv);
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(fromBase64(blob.ciphertext)),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as T;
}

export function encodeBlobCompact(blob: EncryptedBlob): string {
  return `OT1.${blob.salt}.${blob.iv}.${blob.ciphertext}`;
}

export function decodeBlobCompact(value: string): EncryptedBlob {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "OT1") {
    throw new Error("Invalid OpenTerm sync payload");
  }
  return {
    v: 1,
    salt: parts[1]!,
    iv: parts[2]!,
    ciphertext: parts[3]!,
  };
}

export function splitPayload(payload: string, chunkSize = 800): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += chunkSize) {
    chunks.push(payload.slice(i, i + chunkSize));
  }
  return chunks;
}

export function wrapChunk(chunks: string[], index: number): string {
  return JSON.stringify({
    ot: 1,
    i: index,
    n: chunks.length,
    d: chunks[index],
  });
}

export function parseChunk(raw: string): { i: number; n: number; d: string } {
  const parsed = JSON.parse(raw) as { ot?: number; i?: number; n?: number; d?: string };
  if (parsed.ot !== 1 || typeof parsed.i !== "number" || typeof parsed.n !== "number" || !parsed.d) {
    throw new Error("Invalid QR chunk");
  }
  return { i: parsed.i, n: parsed.n, d: parsed.d };
}
