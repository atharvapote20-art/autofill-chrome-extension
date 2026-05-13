import type {
  ExtensionSettings,
  Profile,
  SmartFillProvider,
  Snippet,
  VaultDocument,
  VaultEnvelope,
  WorkerResponse,
} from "../shared/messages.js";
import { PROFILE_FIELD_PRESETS, defaultExtensionSettings } from "../shared/messages.js";
import { dispatchToBackground } from "../shared/worker-gateway.js";
import { STORAGE_LAST_PROFILE_ID } from "../shared/storage-keys.js";

let localCopy: VaultDocument | null = null;
let activeSnippetId: string | null = null;

const unlockPanel = document.getElementById("unlockPanel")!;
const editor = document.getElementById("editor")!;
const vaultpass = document.getElementById("vaultpass") as HTMLInputElement;
const vaultunlock = document.getElementById("vaultunlock") as HTMLButtonElement;
const unlockErr = document.getElementById("unlockErr") as HTMLParagraphElement;
const unlockHeading = document.getElementById("unlockHeading")!;
const railNav = document.getElementById("railNav") as HTMLElement;

const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
const tabpanels = {
  prefs: document.getElementById("tab-prefs")!,
  profiles: document.getElementById("tab-profiles")!,
  snippets: document.getElementById("tab-snippets")!,
  backup: document.getElementById("tab-backup")!,
};

const prefHighlight = document.getElementById("prefHighlight") as HTMLInputElement;
const prefTimeout = document.getElementById("prefTimeout") as HTMLInputElement;
const prefSkipHidden = document.getElementById("prefSkipHidden") as HTMLInputElement;
const prefLearn = document.getElementById("prefLearn") as HTMLInputElement;
const prefFieldAssist = document.getElementById("prefFieldAssist") as HTMLInputElement;
const prefPromptSave = document.getElementById("prefPromptSave") as HTMLInputElement;
const prefSmartFill = document.getElementById("prefSmartFill") as HTMLSelectElement;
const geminiKeyRow = document.getElementById("geminiKeyRow") as HTMLElement;
const groqKeyRow = document.getElementById("groqKeyRow") as HTMLElement;
const groqModelRow = document.getElementById("groqModelRow") as HTMLElement;
const prefGeminiKey = document.getElementById("prefGeminiKey") as HTMLInputElement;
const prefGroqKey = document.getElementById("prefGroqKey") as HTMLInputElement;
const prefGroqModel = document.getElementById("prefGroqModel") as HTMLInputElement;
const prefMax = document.getElementById("prefMax") as HTMLInputElement;
const savePrefs = document.getElementById("savePrefs") as HTMLButtonElement;
const prefMsg = document.getElementById("prefMsg") as HTMLParagraphElement;

const profilePick = document.getElementById("profilePick") as HTMLSelectElement;
const profileName = document.getElementById("profileName") as HTMLInputElement;
const profileDefault = document.getElementById("profileDefault") as HTMLInputElement;
const fieldGrid = document.getElementById("fieldGrid")!;
const customKey = document.getElementById("customKey") as HTMLInputElement;
const customVal = document.getElementById("customVal") as HTMLInputElement;
const addCustom = document.getElementById("addCustom") as HTMLButtonElement;
const addProfile = document.getElementById("addProfile") as HTMLButtonElement;
const saveProfile = document.getElementById("saveProfile") as HTMLButtonElement;
const delProfile = document.getElementById("delProfile") as HTMLButtonElement;
const profMsg = document.getElementById("profMsg") as HTMLParagraphElement;

const snippetList = document.getElementById("snippetList")!;
const snipTitle = document.getElementById("snipTitle") as HTMLInputElement;
const snipBody = document.getElementById("snipBody") as HTMLTextAreaElement;
const snipTags = document.getElementById("snipTags") as HTMLInputElement;
const saveSnippet = document.getElementById("saveSnippet") as HTMLButtonElement;
const newSnippet = document.getElementById("newSnippet") as HTMLButtonElement;
const snipMsg = document.getElementById("snipMsg") as HTMLParagraphElement;

const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const importArea = document.getElementById("importArea") as HTMLTextAreaElement;
const importPass = document.getElementById("importPass") as HTMLInputElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;
const backupMsg = document.getElementById("backupMsg") as HTMLParagraphElement;

function workerErrText(res: WorkerResponse): string {
  if (res.ok) return "";
  if (res.code === "LOCKED") {
    return "Vault is locked. Unlock from the toolbar popup (or unlock above), then save again.";
  }
  return res.detail ?? res.code ?? "Request failed";
}

function flashFail(el: HTMLElement, res: WorkerResponse, fallback: string): void {
  flash(el, res.ok ? fallback : workerErrText(res) || fallback);
}

function flash(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.hidden = false;
  window.setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function showUnlockError(text: string): void {
  unlockErr.textContent = text;
  unlockErr.hidden = false;
}

function clearUnlockError(): void {
  unlockErr.hidden = true;
  unlockErr.textContent = "";
}

async function boot(): Promise<void> {
  clearUnlockError();
  const st = await dispatchToBackground({ kind: "status" });
  if (!st.ok) {
    showUnlockError(st.detail ?? st.code);
    return;
  }
  if (!("status" in st)) {
    showUnlockError("Unexpected response");
    return;
  }
  if (!st.status.hasVault) {
    unlockHeading.textContent = "No vault yet";
    railNav.hidden = true;
    vaultunlock.textContent = "Open toolbar popup to create a vault";
    vaultunlock.disabled = true;
    vaultpass.disabled = true;
    editor.hidden = true;
    unlockPanel.hidden = false;
    return;
  }
  unlockHeading.textContent = "Unlock vault";
  railNav.hidden = true;
  vaultunlock.disabled = false;
  vaultpass.disabled = false;
  vaultunlock.textContent = "Unlock";
  if (st.status.unlocked) {
    await openEditor();
  } else {
    editor.hidden = true;
    unlockPanel.hidden = false;
    railNav.hidden = true;
  }
}

vaultunlock.addEventListener("click", async () => {
  clearUnlockError();
  const res = await dispatchToBackground({ kind: "unlock", passphrase: vaultpass.value });
  if (!res.ok) {
    showUnlockError(res.code === "WRONG_PASSPHRASE" ? "Wrong password." : res.detail ?? res.code);
    return;
  }
  vaultpass.value = "";
  await openEditor();
});

async function openEditor(): Promise<void> {
  unlockPanel.hidden = true;
  editor.hidden = false;
  railNav.hidden = false;
  const docRes = await dispatchToBackground({ kind: "vaultDocumentSnapshot" });
  if (!docRes.ok || !("document" in docRes)) {
    unlockPanel.hidden = false;
    editor.hidden = true;
    railNav.hidden = true;
    showUnlockError("Could not load vault (locked?)");
    return;
  }
  localCopy = docRes.document;
  const prefs = await dispatchToBackground({ kind: "readSettings" });
  if (prefs.ok && "settings" in prefs) hydratePrefs(prefs.settings);
  renderProfileSelect();
  selectProfile(profilePick.value || localCopy.profiles[0]!.id);
  renderSnippetList();
  clearSnippetForm();
  tabs.forEach((t) => t.classList.remove("active"));
  tabs[0]?.classList.add("active");
  Object.entries(tabpanels).forEach(([k, el]) => {
    el.hidden = k !== "prefs";
  });
}

function syncSmartFillRows(): void {
  const v = prefSmartFill.value as SmartFillProvider;
  geminiKeyRow.hidden = v !== "gemini";
  groqKeyRow.hidden = v !== "groq";
  groqModelRow.hidden = v !== "groq";
}

function hydratePrefs(s: ExtensionSettings): void {
  const merged = { ...defaultExtensionSettings(), ...s };
  prefHighlight.checked = merged.highlightFilledFields;
  prefTimeout.value = String(merged.sessionTimeoutMinutes);
  prefSkipHidden.checked = merged.skipHiddenFields;
  prefLearn.checked = merged.learnFromSubmittedForms;
  prefFieldAssist.checked = merged.fieldAssistEnabled;
  prefPromptSave.checked = merged.promptSaveOnBlur;
  prefSmartFill.value = merged.smartFillProvider;
  prefGeminiKey.value = merged.geminiApiKey ?? "";
  prefGroqKey.value = merged.groqApiKey ?? "";
  prefGroqModel.value = merged.groqModel ?? "llama-3.3-70b-versatile";
  prefMax.value = String(merged.maxFieldsPerFill);
  syncSmartFillRows();
}

prefSmartFill.addEventListener("change", syncSmartFillRows);

savePrefs.addEventListener("click", async () => {
  const read = await dispatchToBackground({ kind: "readSettings" });
  const base =
    read.ok && "settings" in read
      ? { ...defaultExtensionSettings(), ...read.settings }
      : defaultExtensionSettings();
  const next: ExtensionSettings = {
    ...base,
    highlightFilledFields: prefHighlight.checked,
    sessionTimeoutMinutes: clamp(parseInt(prefTimeout.value, 10) || 15, 1, 1440),
    skipHiddenFields: prefSkipHidden.checked,
    learnFromSubmittedForms: prefLearn.checked,
    fieldAssistEnabled: prefFieldAssist.checked,
    promptSaveOnBlur: prefPromptSave.checked,
    smartFillProvider: prefSmartFill.value as SmartFillProvider,
    geminiApiKey: prefGeminiKey.value.trim(),
    groqApiKey: prefGroqKey.value.trim(),
    groqModel: prefGroqModel.value.trim() || "llama-3.3-70b-versatile",
    maxFieldsPerFill: clamp(parseInt(prefMax.value, 10) || 48, 1, 200),
  };
  const res = await dispatchToBackground({ kind: "writeSettings", settings: next });
  if (!res.ok) flashFail(prefMsg, res, "Save failed");
  else flash(prefMsg, "Preferences saved");
});

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabs.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const key = btn.dataset.tab as keyof typeof tabpanels;
    Object.entries(tabpanels).forEach(([k, el]) => {
      el.hidden = k !== key;
    });
  });
});

function renderProfileSelect(): void {
  if (!localCopy) return;
  profilePick.innerHTML = "";
  for (const p of localCopy.profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    profilePick.appendChild(opt);
  }
}

function currentProfile(): Profile | null {
  if (!localCopy) return null;
  return localCopy.profiles.find((p) => p.id === profilePick.value) ?? null;
}

function selectProfile(id: string): void {
  profilePick.value = id;
  const p = currentProfile();
  if (!p) return;
  profileName.value = p.name;
  profileDefault.checked = p.isDefault;
  fieldGrid.innerHTML = "";
  const keys = mergedFieldKeys(p);
  for (const key of keys) {
    const lab = document.createElement("label");
    lab.className = "sfv-fields__lab";
    lab.textContent = key;
    const inp = document.createElement("input");
    inp.className = "sfv-oinput";
    inp.type = "text";
    inp.dataset.fieldKey = key;
    inp.value = p.fields[key] ?? "";
    fieldGrid.append(lab, inp);
  }
}

function mergedFieldKeys(p: Profile): string[] {
  const set = new Set<string>([...PROFILE_FIELD_PRESETS, ...Object.keys(p.fields)]);
  return Array.from(set);
}

profilePick.addEventListener("change", () => {
  void chrome.storage.local.set({ [STORAGE_LAST_PROFILE_ID]: profilePick.value });
  selectProfile(profilePick.value);
});

addProfile.addEventListener("click", () => {
  if (!localCopy) return;
  const np: Profile = {
    id: crypto.randomUUID(),
    name: "New profile",
    isDefault: false,
    fields: Object.fromEntries(PROFILE_FIELD_PRESETS.map((k) => [k, ""])),
  };
  localCopy.profiles.push(np);
  renderProfileSelect();
  selectProfile(np.id);
});

addCustom.addEventListener("click", () => {
  const k = customKey.value.trim();
  if (!k) return;
  const p = currentProfile();
  if (!p) return;
  p.fields[k] = customVal.value;
  customKey.value = "";
  customVal.value = "";
  selectProfile(p.id);
});

saveProfile.addEventListener("click", async () => {
  const p = currentProfile();
  if (!p) return;
  p.name = profileName.value.trim() || p.name;
  p.isDefault = profileDefault.checked;
  if (p.isDefault && localCopy) {
    for (const o of localCopy.profiles) {
      if (o.id !== p.id) o.isDefault = false;
    }
  }
  for (const inp of Array.from(fieldGrid.querySelectorAll<HTMLInputElement>("input[data-field-key]"))) {
    const key = inp.dataset.fieldKey!;
    p.fields[key] = inp.value;
  }
  const res = await dispatchToBackground({
    kind: "applyVaultPatch",
    patch: { op: "upsertProfile", profile: { ...p, fields: { ...p.fields } } },
  });
  if (!res.ok) flashFail(profMsg, res, "Save failed");
  else {
    const snap = await dispatchToBackground({ kind: "vaultDocumentSnapshot" });
    if (snap.ok && "document" in snap) localCopy = snap.document;
    flash(profMsg, "Profile saved");
    renderProfileSelect();
    selectProfile(p.id);
  }
});

delProfile.addEventListener("click", async () => {
  const p = currentProfile();
  if (!p || !localCopy) return;
  if (!window.confirm("Delete this profile?")) return;
  const res = await dispatchToBackground({ kind: "applyVaultPatch", patch: { op: "removeProfile", profileId: p.id } });
  if (!res.ok) flashFail(profMsg, res, "Delete failed");
  else {
    const snap = await dispatchToBackground({ kind: "vaultDocumentSnapshot" });
    if (snap.ok && "document" in snap) localCopy = snap.document;
    renderProfileSelect();
    selectProfile(localCopy!.profiles[0]!.id);
    flash(profMsg, "Deleted");
  }
});

function renderSnippetList(): void {
  snippetList.innerHTML = "";
  if (!localCopy) return;
  for (const s of localCopy.snippets) {
    const li = document.createElement("li");
    li.textContent = s.title || "(untitled)";
    li.dataset.id = s.id;
    li.addEventListener("click", () => loadSnippet(s.id));
    snippetList.appendChild(li);
  }
}

function loadSnippet(id: string): void {
  if (!localCopy) return;
  const s = localCopy.snippets.find((x) => x.id === id);
  if (!s) return;
  activeSnippetId = s.id;
  snipTitle.value = s.title;
  snipBody.value = s.body;
  snipTags.value = s.tags.join(", ");
}

function clearSnippetForm(): void {
  activeSnippetId = null;
  snipTitle.value = "";
  snipBody.value = "";
  snipTags.value = "";
}

newSnippet.addEventListener("click", clearSnippetForm);

saveSnippet.addEventListener("click", async () => {
  if (!localCopy) return;
  const sn: Snippet = {
    id: activeSnippetId ?? crypto.randomUUID(),
    title: snipTitle.value.trim() || "Snippet",
    body: snipBody.value,
    tags: snipTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  const res = await dispatchToBackground({ kind: "applyVaultPatch", patch: { op: "upsertSnippet", snippet: sn } });
  if (!res.ok) flashFail(snipMsg, res, "Save failed");
  else {
    const snap = await dispatchToBackground({ kind: "vaultDocumentSnapshot" });
    if (snap.ok && "document" in snap) localCopy = snap.document;
    renderSnippetList();
    loadSnippet(sn.id);
    flash(snipMsg, "Snippet saved");
  }
});

exportBtn.addEventListener("click", async () => {
  const res = await dispatchToBackground({ kind: "peekEncryptedVault" });
  if (!res.ok || !("vaultEnvelope" in res)) {
    flash(backupMsg, "Nothing to export");
    return;
  }
  const blob = new Blob([JSON.stringify(res.vaultEnvelope, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "secure-form-vault-export.json";
  a.click();
  URL.revokeObjectURL(url);
  flash(backupMsg, "Download started");
});

importBtn.addEventListener("click", async () => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(importArea.value);
  } catch {
    flash(backupMsg, "Invalid JSON");
    return;
  }
  const envelope = parsed as VaultEnvelope;
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    envelope.format !== "sfv-aes-gcm-pbkdf2" ||
    typeof envelope.ciphertext !== "string"
  ) {
    flash(backupMsg, "Not a vault export");
    return;
  }
  if (!window.confirm("Import replaces the existing vault on this device. Continue?")) return;
  const res = await dispatchToBackground({
    kind: "importVault",
    envelope,
    passphrase: importPass.value,
  });
  if (!res.ok) flashFail(backupMsg, res, "Import failed");
  else {
    flash(backupMsg, "Imported — vault unlocked");
    importArea.value = "";
    importPass.value = "";
    await openEditor();
  }
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

void boot();
