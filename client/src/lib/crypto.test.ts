import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeBlobCompact,
  decryptJson,
  encodeBlobCompact,
  encryptJson,
  parseChunk,
  splitPayload,
  wrapChunk,
} from "./crypto";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

describe("vault crypto", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("roundtrips encrypted JSON", async () => {
    const data = { servers: [{ host: "example.com", password: "s3cret" }] };
    const blob = await encryptJson(data, "master-password-123");
    const restored = await decryptJson<typeof data>(blob, "master-password-123");
    expect(restored).toEqual(data);
  });

  it("fails with wrong password", async () => {
    const blob = await encryptJson({ ok: true }, "correct-horse");
    await expect(decryptJson(blob, "wrong-battery")).rejects.toThrow();
  });

  it("encodes compact payload and chunk wrappers", async () => {
    const blob = await encryptJson({ v: 1 }, "pw-12345678");
    const compact = encodeBlobCompact(blob);
    expect(compact.startsWith("OT1.")).toBe(true);
    expect(decodeBlobCompact(compact)).toEqual(blob);

    const chunks = splitPayload(compact, 40);
    expect(chunks.length).toBeGreaterThan(1);
    const wrapped = wrapChunk(chunks, 0);
    const parsed = parseChunk(wrapped);
    expect(parsed.i).toBe(0);
    expect(parsed.n).toBe(chunks.length);
    expect(parsed.d).toBe(chunks[0]);
  });
});
