import { describe, expect, it } from "vitest";
import {
  emptyVaultDocument,
  openVaultDocument,
  sealVaultDocument,
} from "./crypto-core.js";

describe("crypto-core", () => {
  it("round-trips a vault document", async () => {
    const doc = emptyVaultDocument();
    doc.profiles[0]!.fields.email = "hello@example.com";
    const phrase = "correct-horse-battery-staple-phrase";
    const sealed = await sealVaultDocument(doc, phrase, 10_000);
    const back = await openVaultDocument(sealed, phrase);
    expect(back.profiles[0]!.fields.email).toBe("hello@example.com");
  });

  it("rejects wrong passphrase", async () => {
    const doc = emptyVaultDocument();
    const sealed = await sealVaultDocument(doc, "alpha-passphrase-123", 10_000);
    await expect(openVaultDocument(sealed, "wrong-passphrase-999")).rejects.toThrow();
  });
});
