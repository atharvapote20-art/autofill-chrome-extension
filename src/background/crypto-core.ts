import type { VaultDocument, Profile } from "../shared/messages.js";
import { PROFILE_FIELD_PRESETS } from "../shared/messages.js";

const textEncoder = new TextEncoder();

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importPbkdf2Key(passphrase: string): Promise<CryptoKey> {
  const material = textEncoder.encode(passphrase);
  return crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
}

async function deriveAesGcmKey(
  baseKey: CryptoKey,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealVaultDocument(
  document: VaultDocument,
  passphrase: string,
  pbkdf2Iterations: number,
): Promise<{
  iv: string;
  salt: string;
  ciphertext: string;
  pbkdf2Iterations: number;
}> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const pbkdfKey = await importPbkdf2Key(passphrase);
  const aesKey = await deriveAesGcmKey(pbkdfKey, salt, pbkdf2Iterations);
  const plain = textEncoder.encode(JSON.stringify(document));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aesKey,
    plain,
  );
  return {
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    pbkdf2Iterations,
  };
}

export async function openVaultDocument(
  envelope: {
    iv: string;
    salt: string;
    ciphertext: string;
    pbkdf2Iterations: number;
  },
  passphrase: string,
): Promise<VaultDocument> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const cipher = base64ToBytes(envelope.ciphertext);
  const pbkdfKey = await importPbkdf2Key(passphrase);
  const aesKey = await deriveAesGcmKey(pbkdfKey, salt, envelope.pbkdf2Iterations);
  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      aesKey,
      cipher as BufferSource,
    );
  } catch {
    throw new Error("DECRYPT_FAILED");
  }
  const json = new TextDecoder().decode(plainBuffer);
  const parsed = JSON.parse(json) as VaultDocument;
  if (!parsed || typeof parsed.schemaVersion !== "number") throw new Error("BAD_DOCUMENT");
  return parsed;
}

export function emptyVaultDocument(): VaultDocument {
  const starter: Profile = {
    id: crypto.randomUUID(),
    name: "Personal",
    isDefault: true,
    fields: Object.fromEntries(PROFILE_FIELD_PRESETS.map((key) => [key, ""])),
  };
  return { schemaVersion: 1, profiles: [starter], snippets: [] };
}

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;
