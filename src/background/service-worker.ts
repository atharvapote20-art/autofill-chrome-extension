import type { WorkerRequest, WorkerResponse } from "../shared/messages.js";
import { PROFILE_FIELD_PRESETS } from "../shared/messages.js";
import { inferProfileFieldKey, listMatchingProfileSuggestions } from "../shared/field-match.js";
import { validateNewMasterPassword } from "../shared/password-policy.js";
import { fetchGeminiFieldKeys, fetchGroqFieldKeys } from "./llm-field-map.js";
import * as vault from "./vault-controller.js";

const SESSION_ALARM = "sfvSessionSweep";

chrome.runtime.onInstalled.addListener(() => {
  void vault.loadSettings().then((s) => scheduleSessionSweep(s.sessionTimeoutMinutes));
});

chrome.runtime.onStartup.addListener(() => {
  vault.lockSession();
  void broadcastLocked();
  void vault.loadSettings().then((s) => scheduleSessionSweep(s.sessionTimeoutMinutes));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SESSION_ALARM) {
    vault.lockSession();
    void broadcastLocked();
  }
});

async function broadcastLocked(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ kind: "sessionLocked" });
  } catch {
    /* no receivers */
  }
}

async function broadcastUnlocked(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ kind: "sessionUnlocked" });
  } catch {
    /* no receivers */
  }
}

function scheduleSessionSweep(minutes: number): void {
  const safe = Number.isFinite(minutes) ? minutes : 15;
  const clamped = Math.max(1, Math.min(24 * 60, Math.floor(safe || 15)));
  void chrome.alarms.clear(SESSION_ALARM);
  chrome.alarms.create(SESSION_ALARM, { delayInMinutes: clamped });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FillPageMessage =
  | { kind: "listFillCandidates"; skipHidden: boolean }
  | {
      kind: "executeFill";
      profilePack: Record<string, string>;
      highlight: boolean;
      skipHidden: boolean;
      maxFields: number;
      geminiKeys?: (string | null)[] | null;
    };

/** Content script may be missing until reload; inject the bundled IIFE then retry once. */
async function sendTabMessage<T>(tabId: number, msg: FillPageMessage): Promise<T> {
  const send = (): Promise<T> => chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
  try {
    return await send();
  } catch (first) {
    const m = first instanceof Error ? first.message : String(first);
    const retriable = /Receiving end does not exist|Could not establish connection/i.test(m);
    if (!retriable) throw first;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"],
      });
    } catch {
      throw first;
    }
    await sleep(120);
    return await send();
  }
}

async function handleRequest(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    await vault.tryRestoreUnlockedSession();
    if (vault.isSessionOpen()) {
      const s = await vault.loadSettings();
      scheduleSessionSweep(s.sessionTimeoutMinutes);
    }
    switch (req.kind) {
      case "sessionGate": {
        return { ok: true, unlocked: vault.isSessionOpen() };
      }
      case "readSettings": {
        const settings = await vault.loadSettings();
        return { ok: true, settings };
      }
      case "writeSettings": {
        await vault.saveSettings(req.settings);
        scheduleSessionSweep(req.settings.sessionTimeoutMinutes);
        return { ok: true, saved: true };
      }
      case "status": {
        const status = await vault.snapshotStatusAsync();
        return { ok: true, status };
      }
      case "bootstrapVault": {
        const exists = await vault.readEnvelopeFromDisk();
        if (exists) {
          return { ok: false, code: "INTERNAL", detail: "Vault already exists" };
        }
        const passErr = validateNewMasterPassword(req.passphrase);
        if (passErr) return { ok: false, code: "INTERNAL", detail: passErr };
        await vault.createFreshVault(req.passphrase);
        await vault.persistUnlockedVault();
        const status = await vault.snapshotStatusAsync();
        const settings = await vault.loadSettings();
        scheduleSessionSweep(settings.sessionTimeoutMinutes);
        void broadcastUnlocked();
        return { ok: true, status };
      }
      case "importVault": {
        await vault.replaceEnvelopeFromImport(req.envelope, req.passphrase);
        const settings = await vault.loadSettings();
        scheduleSessionSweep(settings.sessionTimeoutMinutes);
        const status = await vault.snapshotStatusAsync();
        void broadcastUnlocked();
        return { ok: true, status };
      }
      case "unlock": {
        try {
          await vault.unlockWithPassphrase(req.passphrase);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "NO_VAULT") return { ok: false, code: "NO_VAULT" };
          return { ok: false, code: "WRONG_PASSPHRASE" };
        }
        const settings = await vault.loadSettings();
        scheduleSessionSweep(settings.sessionTimeoutMinutes);
        const status = await vault.snapshotStatusAsync();
        void broadcastUnlocked();
        return { ok: true, status };
      }
      case "lock": {
        vault.lockSession();
        void chrome.alarms.clear(SESSION_ALARM);
        void broadcastLocked();
        const status = await vault.snapshotStatusAsync();
        return { ok: true, status };
      }
      case "applyVaultPatch": {
        if (!vault.isSessionOpen()) return { ok: false, code: "LOCKED" };
        vault.applyPatch(req.patch);
        await vault.persistUnlockedVault();
        const status = await vault.snapshotStatusAsync();
        return { ok: true, status };
      }
      case "peekEncryptedVault": {
        const env = await vault.readEnvelopeFromDisk();
        if (!env) return { ok: false, code: "NO_VAULT" };
        return { ok: true, vaultEnvelope: env };
      }
      case "vaultDocumentSnapshot": {
        if (!vault.isSessionOpen()) return { ok: false, code: "LOCKED" };
        return { ok: true, document: vault.snapshotVaultClone() };
      }
      case "suggestForAssist": {
        if (!vault.isSessionOpen()) {
          return {
            ok: true,
            assist: { suggestions: [], inferredKey: null, storedForInferred: null },
          };
        }
        const doc = vault.snapshotVaultClone();
        let profileId = await vault.readLastUsedProfileId();
        if (!profileId || !doc.profiles.some((p) => p.id === profileId)) {
          profileId =
            doc.profiles.find((p) => p.isDefault)?.id ?? doc.profiles[0]?.id ?? null;
        }
        if (!profileId) {
          return {
            ok: true,
            assist: { suggestions: [], inferredKey: null, storedForInferred: null },
          };
        }
        const profile = doc.profiles.find((p) => p.id === profileId);
        if (!profile) {
          return {
            ok: true,
            assist: { suggestions: [], inferredKey: null, storedForInferred: null },
          };
        }
        const hay = String(req.haystack ?? "");
        const inferredKey = inferProfileFieldKey(hay);
        const storedForInferred =
          inferredKey != null ? (profile.fields[inferredKey] ?? "").trim() || null : null;
        const suggestions = listMatchingProfileSuggestions(hay, profile.fields, 8);
        return { ok: true, assist: { suggestions, inferredKey, storedForInferred } };
      }
      case "saveFieldToProfile": {
        if (!vault.isSessionOpen()) return { ok: false, code: "LOCKED" };
        const fieldKey = String(req.fieldKey ?? "").trim();
        if (!isProfileFieldKeyAllowed(fieldKey)) {
          return { ok: false, code: "INTERNAL", detail: "Invalid field key" };
        }
        const value = String(req.value ?? "").trim();
        if (!value) return { ok: true, saved: true };
        if (value.length > 8000) {
          return { ok: false, code: "INTERNAL", detail: "Value too long" };
        }
        const doc = vault.snapshotVaultClone();
        let profileId = await vault.readLastUsedProfileId();
        if (!profileId || !doc.profiles.some((p) => p.id === profileId)) {
          profileId =
            doc.profiles.find((p) => p.isDefault)?.id ?? doc.profiles[0]?.id ?? null;
        }
        if (!profileId) return { ok: false, code: "INTERNAL", detail: "No profile" };
        const profile = doc.profiles.find((p) => p.id === profileId);
        if (!profile) return { ok: false, code: "INTERNAL", detail: "No profile" };
        const nextFields = { ...profile.fields, [fieldKey]: value };
        vault.applyPatch({
          op: "upsertProfile",
          profile: { ...profile, fields: nextFields },
        });
        await vault.persistUnlockedVault();
        return { ok: true, saved: true };
      }
      case "captureFormSubmit": {
        if (!vault.isSessionOpen()) return { ok: true, saved: true };
        const settings = await vault.loadSettings();
        if (!settings.learnFromSubmittedForms) return { ok: true, saved: true };
        const allowed = new Set(PROFILE_FIELD_PRESETS);
        const doc = vault.snapshotVaultClone();
        let profileId = await vault.readLastUsedProfileId();
        if (!profileId || !doc.profiles.some((p) => p.id === profileId)) {
          profileId =
            doc.profiles.find((p) => p.isDefault)?.id ?? doc.profiles[0]?.id ?? null;
        }
        if (!profileId) return { ok: true, saved: true };
        const profile = doc.profiles.find((p) => p.id === profileId);
        if (!profile) return { ok: true, saved: true };
        const nextFields = { ...profile.fields };
        let touched = false;
        for (const [k, raw] of Object.entries(req.fields)) {
          if (!allowed.has(k)) continue;
          const v = String(raw ?? "").trim();
          if (!v || v.length > 8000) continue;
          nextFields[k] = v;
          touched = true;
        }
        if (!touched) return { ok: true, saved: true };
        vault.applyPatch({ op: "upsertProfile", profile: { ...profile, fields: nextFields } });
        await vault.persistUnlockedVault();
        return { ok: true, saved: true };
      }
      case "fillActiveTab": {
        return await fillActiveTabWithProfile(req.profileId);
      }
      default:
        return { ok: false, code: "INTERNAL", detail: "Unknown request" };
    }
  } catch (e) {
    return {
      ok: false,
      code: "INTERNAL",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function resolveProfileIdForFill(preferredId?: string): Promise<string | null> {
  const doc = vault.snapshotVaultClone();
  if (preferredId && doc.profiles.some((p) => p.id === preferredId)) return preferredId;
  let profileId = await vault.readLastUsedProfileId();
  if (!profileId || !doc.profiles.some((p) => p.id === profileId)) {
    profileId = doc.profiles.find((p) => p.isDefault)?.id ?? doc.profiles[0]?.id ?? null;
  }
  return profileId;
}

async function fillActiveTabWithProfile(profileId: string): Promise<WorkerResponse> {
  if (!vault.isSessionOpen()) return { ok: false, code: "LOCKED" };
  const doc = vault.snapshotVaultClone();
  const profile = doc.profiles.find((p) => p.id === profileId);
  if (!profile) return { ok: false, code: "INTERNAL", detail: "Unknown profile" };
  await vault.writeLastUsedProfileId(profileId);
  const settings = await vault.loadSettings();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (!active?.id || !active.url?.match(/^https?:\/\//i)) {
    return { ok: false, code: "BAD_TAB" };
  }
  const pack = buildProfilePack(profile.fields, doc.snippets);
  let geminiKeys: (string | null)[] | undefined;
  const geminiNotes: string[] = [];
  const provider = settings.smartFillProvider;
  if (provider === "gemini" && settings.geminiApiKey.trim()) {
    try {
      const listed = await sendTabMessage<{ haystacks?: string[] }>(active.id, {
        kind: "listFillCandidates",
        skipHidden: settings.skipHiddenFields,
      });
      const stacks = Array.isArray(listed?.haystacks) ? listed.haystacks : [];
      if (stacks.length) {
        const assignments = await fetchGeminiFieldKeys(
          settings.geminiApiKey.trim(),
          stacks,
          pack,
        );
        if (assignments.some((k) => k != null)) {
          geminiKeys = assignments;
          geminiNotes.push("Used Gemini for field matching.");
        } else {
          geminiNotes.push("Gemini returned no field matches; using keyword matching.");
        }
      }
    } catch (e) {
      geminiNotes.push(
        `Gemini: ${e instanceof Error ? e.message : String(e)} (keyword matching used).`,
      );
    }
  } else if (provider === "groq" && settings.groqApiKey.trim()) {
    try {
      const listed = await sendTabMessage<{ haystacks?: string[] }>(active.id, {
        kind: "listFillCandidates",
        skipHidden: settings.skipHiddenFields,
      });
      const stacks = Array.isArray(listed?.haystacks) ? listed.haystacks : [];
      if (stacks.length) {
        const assignments = await fetchGroqFieldKeys(
          settings.groqApiKey.trim(),
          settings.groqModel || "llama-3.3-70b-versatile",
          stacks,
          pack,
        );
        if (assignments.some((k) => k != null)) {
          geminiKeys = assignments;
          geminiNotes.push("Used Groq for field matching.");
        } else {
          geminiNotes.push("Groq returned no field matches; using keyword matching.");
        }
      }
    } catch (e) {
      geminiNotes.push(
        `Groq: ${e instanceof Error ? e.message : String(e)} (keyword matching used).`,
      );
    }
  }
  let summary: { filled: number; skipped: number; notes: string[] };
  try {
    summary = await sendTabMessage(active.id, {
      kind: "executeFill",
      profilePack: pack,
      highlight: settings.highlightFilledFields,
      skipHidden: settings.skipHiddenFields,
      maxFields: settings.maxFieldsPerFill,
      geminiKeys: geminiKeys ?? null,
    });
  } catch (e) {
    return {
      ok: false,
      code: "INJECT_FAILED",
      detail:
        e instanceof Error
          ? e.message
          : "Could not reach the page script. Reload the tab and try again.",
    };
  }
  if (geminiNotes.length) {
    summary.notes = [...geminiNotes, ...summary.notes];
  }
  return { ok: true, fillSummary: summary };
}

async function flashActionBadge(text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      void chrome.action.setBadgeText({ text: "" });
    }, 2200);
  } catch {
    /* ignore */
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "fill-active-tab") return;
  void (async () => {
    await vault.tryRestoreUnlockedSession();
    if (vault.isSessionOpen()) {
      const s = await vault.loadSettings();
      scheduleSessionSweep(s.sessionTimeoutMinutes);
    } else {
      await flashActionBadge("!", "#b42318");
      return;
    }
    const profileId = await resolveProfileIdForFill();
    if (!profileId) {
      await flashActionBadge("!", "#b42318");
      return;
    }
    const res = await fillActiveTabWithProfile(profileId);
    if (res.ok) await flashActionBadge("OK", "#0f7b4a");
    else await flashActionBadge("!", "#b42318");
  })();
});

function buildProfilePack(
  fields: Record<string, string>,
  snippets: { id: string; title: string; body: string }[],
): Record<string, string> {
  const pack: Record<string, string> = { ...fields };
  for (const sn of snippets) {
    const slug = slugifySnippetKey(sn.title);
    pack[`snippet:${slug}`] = sn.body;
    pack[`snippetId:${sn.id}`] = sn.body;
  }
  return pack;
}

function isProfileFieldKeyAllowed(key: string): boolean {
  if (!key || key.length > 80) return false;
  if (/^snippet/i.test(key)) return false;
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key);
}

function slugifySnippetKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, _sender, sendResponse) => {
  void handleRequest(message).then(sendResponse);
  return true;
});
