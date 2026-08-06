import { describe, expect, it } from "vitest";
import { validateNewMasterPassword } from "./password-policy.js";

describe("validateNewMasterPassword", () => {
  it("accepts a strong 10+ character password", () => {
    expect(validateNewMasterPassword("K9#mPx$vL2q")).toBeNull();
  });
  it("rejects under 8 characters", () => {
    expect(validateNewMasterPassword("Aa1!x")).not.toBeNull();
  });
  it("rejects missing uppercase", () => {
    expect(validateNewMasterPassword("aa11!!xxxx")).not.toBeNull();
  });
  it("rejects missing lowercase", () => {
    expect(validateNewMasterPassword("AA11!!XXXX")).not.toBeNull();
  });
  it("rejects missing digit", () => {
    expect(validateNewMasterPassword("AaBb!!XXXX")).not.toBeNull();
  });
  it("rejects missing special", () => {
    expect(validateNewMasterPassword("AaBb11XXXX")).not.toBeNull();
  });
  it("rejects common passwords", () => {
    expect(validateNewMasterPassword("P@ssw0rd")).not.toBeNull();
  });
  it("rejects long repeated run", () => {
    expect(validateNewMasterPassword("Aaaaaa1!xx")).not.toBeNull();
  });
  it("rejects digit sequential run of 6", () => {
    expect(validateNewMasterPassword("Ab1!234567")).not.toBeNull();
  });
  it("rejects letter sequential run of 6", () => {
    expect(validateNewMasterPassword("Abcdef1!gh")).not.toBeNull();
  });
  it("rejects password containing email local part", () => {
    expect(
      validateNewMasterPassword("Xx9!janeDoeSecret", { email: "janedoe@mail.com" }),
    ).not.toBeNull();
  });
  it("rejects password containing username", () => {
    expect(validateNewMasterPassword("Xx9!myalicekey", { username: "alice" })).not.toBeNull();
  });
});
