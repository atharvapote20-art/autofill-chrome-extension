import type {
  ExtensionSettings,
  SmartFillProvider,
  VaultDocument,
  VaultEnvelope,
  VaultPatch,
} from "../shared/messages.js";
import { defaultExtensionSettings } from "../shared/messages.js";
import { STORAGE_LAST_PROFILE_ID } from "../shared/storage-keys.js";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  emptyVaultDocument,
  openVaultDocument,
  sealVaultDocument,
} from "./crypto-core.js";

const VAULT_STORAGE_KEY = "sfvVaultEnvelope";
const SETTINGS_STORAGE_KEY = "sfvUiSettings";
/** Same-browser-session copy; survives MV3 service worker sleep until lock or browser quit. */
const SESSION_PASSPHRASE_KEY = "sfvUnlockPassphrase";

let liveDocument: VaultDocument | null = null;
let sessionPassphrase: string | null = null;

type LegacyExtensionSettings = ExtensionSettings & { geminiFillEnabled?: boolean };

function normalizeSmartFillProvider(input: LegacyExtensionSettings): SmartFillProvider {
  const p = input.smartFillProvider;
  if (p === "gemini" || p === "groq" || p === "none") return p;
  if (input.geminiFillEnabled && String(input.geminiApiKey ?? "").trim()) return "gemini";
  return "none";
}

function sanitizeExtensionSettings(input: ExtensionSettings): ExtensionSettings {
  const d = defaultExtensionSettings();
  const session = Number.isFinite(input.sessionTimeoutMinutes)
    ? input.sessionTimeoutMinutes
    : d.sessionTimeoutMinutes;
  const maxFields = Number.isFinite(input.maxFieldsPerFill)
    ? input.maxFieldsPerFill
    : d.maxFieldsPerFill;
  const merged = { ...d, ...input } as LegacyExtensionSettings;
  const { geminiFillEnabled: _legacyGemini, ...rest } = merged;
  void _legacyGemini;
  return {
    ...rest,
    highlightFilledFields: Boolean(merged.highlightFilledFields),
    skipHiddenFields: merged.skipHiddenFields !== false,
    learnFromSubmittedForms: Boolean(merged.learnFromSubmittedForms),
    fieldAssistEnabled: merged.fieldAssistEnabled !== false,
    promptSaveOnBlur: merged.promptSaveOnBlur !== false,
    smartFillProvider: normalizeSmartFillProvider(merged),
    geminiApiKey: String(merged.geminiApiKey ?? "")
      .trim()
      .slice(0, 256),
    groqApiKey: String(merged.groqApiKey ?? "")
      .trim()
      .slice(0, 256),
    groqModel: String(merged.groqModel ?? d.groqModel)
      .trim()
      .slice(0, 80),
    sessionTimeoutMinutes: Math.max(1, Math.min(24 * 60, Math.floor(session))),
    maxFieldsPerFill: Math.max(1, Math.min(200, Math.floor(maxFields))),
  };
}

async function persistPassphraseToSessionStorage(passphrase: string): Promise<void> {
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [SESSION_PASSPHRASE_KEY]: passphrase });
    }
  } catch {
    /* ignore */
  }
}

async function clearPassphraseFromSessionStorage(): Promise<void> {
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.remove([SESSION_PASSPHRASE_KEY]);
    }
  } catch {
    /* ignore */
  }
}

/**
 * After MV3 service worker restarts, in-memory vault is empty. Re-open from passphrase
 * kept in chrome.storage.session (same browser session only).
 */
export async function tryRestoreUnlockedSession(): Promise<boolean> {
  if (liveDocument !== null && sessionPassphrase !== null) return true;
  try {
    if (!chrome.storage?.session) return false;
    const bag = await chrome.storage.session.get(SESSION_PASSPHRASE_KEY);
    const p = bag[SESSION_PASSPHRASE_KEY] as string | undefined;
    if (!p) return false;
    const envelope = await readEnvelopeFromDisk();
    if (!envelope) {
      await clearPassphraseFromSessionStorage();
      return false;
    }
    try {
      liveDocument = await openVaultDocument(envelope, p);
      sessionPassphrase = p;
      return true;
    } catch {
      await clearPassphraseFromSessionStorage();
      return false;
    }
  } catch {
    return false;
  }
}

export function isSessionOpen(): boolean {
  return liveDocument !== null && sessionPassphrase !== null;
}

export function requireUnlockedDocument(): VaultDocument {
  if (!liveDocument) throw new Error("LOCKED");
  return liveDocument;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const bag = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = bag[SETTINGS_STORAGE_KEY] as ExtensionSettings | undefined;
  return sanitizeExtensionSettings({ ...defaultExtensionSettings(), ...raw });
}

export async function saveSettings(next: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: sanitizeExtensionSettings(next) });
}

export async function readEnvelopeFromDisk(): Promise<VaultEnvelope | null> {
  const bag = await chrome.storage.local.get(VAULT_STORAGE_KEY);
  return (bag[VAULT_STORAGE_KEY] as VaultEnvelope | undefined) ?? null;
}

export async function createFreshVault(passphrase: string): Promise<void> {
  const doc = emptyVaultDocument();
  const sealed = await sealVaultDocument(doc, passphrase, DEFAULT_PBKDF2_ITERATIONS);
  const envelope: VaultEnvelope = {
    format: "sfv-aes-gcm-pbkdf2",
    schemaVersion: 1,
    ...sealed,
  };
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: envelope });
  liveDocument = doc;
  sessionPassphrase = passphrase;
  await persistPassphraseToSessionStorage(passphrase);
}

export async function unlockWithPassphrase(passphrase: string): Promise<void> {
  const envelope = await readEnvelopeFromDisk();
  if (!envelope) throw new Error("NO_VAULT");
  try {
    liveDocument = await openVaultDocument(envelope, passphrase);
  } catch {
    throw new Error("WRONG_PASSPHRASE");
  }
  sessionPassphrase = passphrase;
  await persistPassphraseToSessionStorage(passphrase);
}

export function lockSession(): void {
  liveDocument = null;
  sessionPassphrase = null;
  void clearPassphraseFromSessionStorage();
}

export async function persistUnlockedVault(): Promise<void> {
  if (!liveDocument || !sessionPassphrase) throw new Error("LOCKED");
  const envelopeOnDisk = await readEnvelopeFromDisk();
  const iterations = envelopeOnDisk?.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const sealed = await sealVaultDocument(liveDocument, sessionPassphrase, iterations);
  const envelope: VaultEnvelope = {
    format: "sfv-aes-gcm-pbkdf2",
    schemaVersion: 1,
    ...sealed,
  };
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: envelope });
}

export async function replaceEnvelopeFromImport(
  envelope: VaultEnvelope,
  passphrase: string,
): Promise<void> {
  const doc = await openVaultDocument(
    {
      iv: envelope.iv,
      salt: envelope.salt,
      ciphertext: envelope.ciphertext,
      pbkdf2Iterations: envelope.pbkdf2Iterations,
    },
    passphrase,
  );
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: envelope });
  liveDocument = doc;
  sessionPassphrase = passphrase;
  await persistPassphraseToSessionStorage(passphrase);
}

export async function snapshotStatusAsync(): Promise<{
  hasVault: boolean;
  unlocked: boolean;
  profileSummaries: { id: string; name: string; isDefault: boolean }[];
  defaultProfileId: string | null;
}> {
  const envelope = await readEnvelopeFromDisk();
  const hasVault = envelope !== null;
  if (!liveDocument) {
    return {
      hasVault,
      unlocked: false,
      profileSummaries: [],
      defaultProfileId: null,
    };
  }
  const profileSummaries = liveDocument.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
  }));
  const defaultProfileId =
    liveDocument.profiles.find((p) => p.isDefault)?.id ??
    liveDocument.profiles[0]?.id ??
    null;
  return {
    hasVault,
    unlocked: true,
    profileSummaries,
    defaultProfileId,
  };
}

export function snapshotVaultClone(): VaultDocument {
  const doc = requireUnlockedDocument();
  return structuredClone(doc);
}

export function applyPatch(patch: VaultPatch): void {
  const doc = requireUnlockedDocument();
  if (patch.op === "upsertProfile") {
    const idx = doc.profiles.findIndex((p) => p.id === patch.profile.id);
    if (patch.profile.isDefault) {
      for (const p of doc.profiles) p.isDefault = false;
    }
    if (idx === -1) doc.profiles.push(patch.profile);
    else doc.profiles[idx] = patch.profile;
    ensureDefaultProfile(doc);
  } else if (patch.op === "removeProfile") {
    doc.profiles = doc.profiles.filter((p) => p.id !== patch.profileId);
    if (doc.profiles.length === 0) {
      doc.profiles.push({
        id: crypto.randomUUID(),
        name: "Personal",
        isDefault: true,
        fields: {},
      });
    }
    ensureDefaultProfile(doc);
  } else if (patch.op === "upsertSnippet") {
    const idx = doc.snippets.findIndex((s) => s.id === patch.snippet.id);
    if (idx === -1) doc.snippets.push(patch.snippet);
    else doc.snippets[idx] = patch.snippet;
  } else if (patch.op === "removeSnippet") {
    doc.snippets = doc.snippets.filter((s) => s.id !== patch.snippetId);
  }
}

function ensureDefaultProfile(doc: VaultDocument): void {
  if (doc.profiles.length === 0) return;
  if (!doc.profiles.some((p) => p.isDefault)) {
    doc.profiles[0]!.isDefault = true;
  }
  let seen = false;
  for (const p of doc.profiles) {
    if (p.isDefault) {
      if (seen) p.isDefault = false;
      else seen = true;
    }
  }
}

export async function readLastUsedProfileId(): Promise<string | null> {
  const bag = await chrome.storage.local.get(STORAGE_LAST_PROFILE_ID);
  const id = bag[STORAGE_LAST_PROFILE_ID] as string | undefined;
  return id && id.length > 0 ? id : null;
}

export async function writeLastUsedProfileId(profileId: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LAST_PROFILE_ID]: profileId });
}
