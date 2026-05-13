import type { WorkerResponse } from "../shared/messages.js";
import { validateNewMasterPassword } from "../shared/password-policy.js";
import { dispatchToBackground } from "../shared/worker-gateway.js";
import { STORAGE_LAST_PROFILE_ID } from "../shared/storage-keys.js";

const gate = document.getElementById("gate")!;
const workspace = document.getElementById("workspace")!;
const pass = document.getElementById("pass") as HTMLInputElement;
const pass2 = document.getElementById("pass2") as HTMLInputElement;
const pass2wrap = document.getElementById("pass2wrap")!;
const primary = document.getElementById("primary") as HTMLButtonElement;
const secondary = document.getElementById("secondary") as HTMLButtonElement;
const profile = document.getElementById("profile") as HTMLSelectElement;
const fillBtn = document.getElementById("fill") as HTMLButtonElement;
const lockBtn = document.getElementById("lock") as HTMLButtonElement;
const banner = document.getElementById("banner") as HTMLParagraphElement;
const fillnote = document.getElementById("fillnote") as HTMLParagraphElement;
const openopts = document.getElementById("openopts") as HTMLAnchorElement;
const primaryLabel = document.getElementById("primaryLabel")!;
const gateTitle = document.getElementById("gateTitle")!;
const passwordRulesHint = document.getElementById("passwordRulesHint") as HTMLParagraphElement;

type ScreenMode = "unlock" | "bootstrap";

let mode: ScreenMode = "unlock";

function showBanner(text: string): void {
  banner.textContent = text;
  banner.hidden = false;
}

function clearBanner(): void {
  banner.hidden = true;
  banner.textContent = "";
}

function setBootstrapUi(active: boolean): void {
  mode = active ? "bootstrap" : "unlock";
  pass2.hidden = !active;
  pass2wrap.hidden = !active;
  secondary.hidden = !active;
  primaryLabel.textContent = active ? "Create vault" : "Unlock";
  gateTitle.textContent = active ? "Create your vault" : "Unlock vault";
  passwordRulesHint.hidden = !active;
}

async function refreshShell(): Promise<void> {
  clearBanner();
  const res = await dispatchToBackground({ kind: "status" });
  if (!res.ok) {
    showBanner(res.detail ?? "Could not read status");
    return;
  }
  if (!("status" in res)) {
    showBanner("Unexpected response");
    return;
  }
  const { hasVault, unlocked, profileSummaries, defaultProfileId } = res.status;
  if (!hasVault) {
    gate.hidden = false;
    workspace.hidden = true;
    setBootstrapUi(true);
    return;
  }
  setBootstrapUi(false);
  if (!unlocked) {
    gate.hidden = false;
    workspace.hidden = true;
    return;
  }
  gate.hidden = true;
  workspace.hidden = false;
  profile.innerHTML = "";
  for (const row of profileSummaries) {
    const opt = document.createElement("option");
    opt.value = row.id;
    opt.textContent = row.name + (row.isDefault ? " (default)" : "");
    profile.appendChild(opt);
  }
  const stored = (await chrome.storage.local.get(STORAGE_LAST_PROFILE_ID))[STORAGE_LAST_PROFILE_ID] as
    | string
    | undefined;
  if (stored && profileSummaries.some((r) => r.id === stored)) profile.value = stored;
  else if (defaultProfileId) profile.value = defaultProfileId;
  void chrome.storage.local.set({ [STORAGE_LAST_PROFILE_ID]: profile.value });
  fillnote.textContent = "";
}

profile.addEventListener("change", () => {
  void chrome.storage.local.set({ [STORAGE_LAST_PROFILE_ID]: profile.value });
});

primary.addEventListener("click", async () => {
  clearBanner();
  if (mode === "bootstrap") {
    const a = pass.value.normalize("NFKC").trim();
    const b = pass2.value.normalize("NFKC").trim();
    const bad = validateNewMasterPassword(a);
    if (bad) {
      showBanner(bad);
      return;
    }
    if (a !== b) {
      showBanner("Passwords do not match.");
      return;
    }
    const res = await dispatchToBackground({ kind: "bootstrapVault", passphrase: a });
    if (!handleAuth(res)) return;
    pass.value = "";
    pass2.value = "";
    await refreshShell();
    return;
  }
  const a = pass.value;
  const res = await dispatchToBackground({ kind: "unlock", passphrase: a });
  if (!handleAuth(res)) return;
  pass.value = "";
  await refreshShell();
});

secondary.addEventListener("click", () => {
  clearBanner();
  setBootstrapUi(false);
});

lockBtn.addEventListener("click", async () => {
  clearBanner();
  const res = await dispatchToBackground({ kind: "lock" });
  if (!res.ok) {
    showBanner(res.detail ?? "Lock failed");
    return;
  }
  await refreshShell();
});

fillBtn.addEventListener("click", async () => {
  clearBanner();
  const res = await dispatchToBackground({ kind: "fillActiveTab", profileId: profile.value });
  if (!res.ok) {
    showBanner(renderError(res.code, res.detail));
    return;
  }
  if (!("fillSummary" in res)) {
    showBanner("Unexpected fill response");
    return;
  }
  const { filled, skipped, notes } = res.fillSummary;
  fillnote.textContent = formatFillSummaryLine(filled, skipped, notes);
});

function formatFillSummaryLine(filled: number, skipped: number, notes: string[]): string {
  if (filled === 0 && skipped === 0) {
    return "No fillable inputs found on this tab (only plain <input>/<textarea> in the main page; shadow DOM / iframes / all-hidden fields are skipped). Try Settings ▸ turn off “Skip visually hidden fields”, or reload the form page.";
  }
  if (filled === 0 && skipped > 0) {
    let line = `Found ${skipped} field(s), but labels did not match your profile closely enough. Add clear labels or placeholders on the site, or align profile keys (e.g. email, first name).`;
    if (notes.length) line += ` ${notes.slice(0, 2).join("; ")}`;
    return line;
  }
  let line = `Filled ${filled}. ${skipped} other field(s) had no strong match to your profile.`;
  if (notes.length) line += ` Notes: ${notes.slice(0, 2).join("; ")}`;
  return line;
}

openopts.addEventListener("click", (ev) => {
  ev.preventDefault();
  void chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg: { kind?: string }) => {
  if (msg?.kind === "sessionLocked") void refreshShell();
});

function handleAuth(res: WorkerResponse): boolean {
  if (res.ok) return true;
  if (res.code === "WRONG_PASSPHRASE") showBanner("Wrong password.");
  else if (res.code === "NO_VAULT") showBanner("No vault yet — create one first.");
  else showBanner(res.detail ?? res.code);
  return false;
}

function renderError(code: string, detail?: string): string {
  if (code === "BAD_TAB") return "Open a normal http(s) page on this tab first.";
  if (code === "LOCKED") return "Unlock the vault before filling.";
  if (code === "INJECT_FAILED") {
    if (detail && /Receiving end does not exist|Could not establish connection/i.test(detail)) {
      return "Could not reach the page helper. Reload this tab (F5), then try Fill again.";
    }
    return detail ?? "Could not run on this page.";
  }
  return detail ?? code;
}

void refreshShell();
