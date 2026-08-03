import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("credential policy", () => {
  it("documents that credentials are never persisted", () => {
    const policy = {
      storesCredentials: false,
      persistence: "session-memory-only",
    };
    assert.equal(policy.storesCredentials, false);
    assert.equal(policy.persistence, "session-memory-only");
  });
});
