import type { FillSummary } from "../shared/messages.js";
import { defaultExtensionSettings } from "../shared/messages.js";
import { dispatchToBackground } from "../shared/worker-gateway.js";
import { expandKeySynonyms, inferProfileFieldKey, normalizeText, scoreHaystack } from "../shared/field-match.js";
import { harvestAnyControl, harvestHaystack } from "./dom-harvest.js";
import { applyControlValue } from "./field-value.js";
import { configureFieldAssist, readExtensionSettingsFromStorage } from "./field-assist.js";
import { showFillToast } from "./fill-toast.js";

type FillCommand = {
  kind: "executeFill";
  profilePack: Record<string, string>;
  highlight: boolean;
  skipHidden: boolean;
  maxFields: number;
  geminiKeys?: (string | null)[] | null;
};

type ListCandidatesCommand = { kind: "listFillCandidates"; skipHidden: boolean };

type TabMessage = FillCommand | ListCandidatesCommand;

const bootFlag = "__sfvContentBoot";
const SETTINGS_KEY = "sfvUiSettings";

function alreadyBooted(): boolean {
  return Boolean((globalThis as Record<string, unknown>)[bootFlag]);
}

function markBooted(): void {
  (globalThis as Record<string, unknown>)[bootFlag] = true;
}

function wireListener(): void {
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (msg && typeof msg === "object" && "kind" in msg) {
      const k = (msg as { kind: string }).kind;
      if (k === "sessionLocked") {
        deactivatePageFeatures();
        return false;
      }
      if (k === "sessionUnlocked") {
        void activatePageFeaturesFromSettings();
        return false;
      }
    }
    const m = msg as TabMessage;
    if (m?.kind === "listFillCandidates") {
      void Promise.resolve(listFillCandidates(m.skipHidden))
        .then(sendResponse)
        .catch((err) => {
          sendResponse({ haystacks: [] as string[], error: String(err) });
        });
      return true;
    }
    if (m?.kind !== "executeFill") return false;
    void Promise.resolve(runFillPass(m))
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          filled: 0,
          skipped: 0,
          notes: [err instanceof Error ? err.message : String(err)],
        } satisfies FillSummary);
      });
    return true;
  });
}

if (!alreadyBooted()) {
  markBooted();
  wireListener();
  void syncPageFeaturesWithVault();
}

let settingsListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] | null = null;

function stopListeningSettings(): void {
  if (!settingsListener) return;
  chrome.storage.onChanged.removeListener(settingsListener);
  settingsListener = null;
}

function deactivatePageFeatures(): void {
  stopListeningSettings();
  setLearnListeners(false);
  configureFieldAssist({
    ...defaultExtensionSettings(),
    fieldAssistEnabled: false,
    promptSaveOnBlur: false,
  });
}

async function activatePageFeaturesFromSettings(): Promise<void> {
  deactivatePageFeatures();
  const s = await readExtensionSettingsFromStorage();
  setLearnListeners(s.learnFromSubmittedForms);
  configureFieldAssist(s);
  if (settingsListener) return;
  settingsListener = (changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    void (async () => {
      const next = await readExtensionSettingsFromStorage();
      setLearnListeners(next.learnFromSubmittedForms);
      configureFieldAssist(next);
    })();
  };
  chrome.storage.onChanged.addListener(settingsListener);
}

async function syncPageFeaturesWithVault(): Promise<void> {
  const res = await dispatchToBackground({ kind: "sessionGate" });
  const open = res.ok && "unlocked" in res && res.unlocked === true;
  if (open) await activatePageFeaturesFromSettings();
  else deactivatePageFeatures();
}

let learnAbort: AbortController | null = null;

function setLearnListeners(enabled: boolean): void {
  learnAbort?.abort();
  learnAbort = null;
  if (!enabled) return;
  learnAbort = new AbortController();
  const sig = learnAbort.signal;
  document.addEventListener("submit", onFormSubmitCapture, { capture: true, signal: sig });
}

function onFormSubmitCapture(ev: Event): void {
  const form = ev.target;
  if (!(form instanceof HTMLFormElement)) return;
  void flushFormCapture(form);
}

async function flushFormCapture(form: HTMLFormElement): Promise<void> {
  const fields: Record<string, string> = {};
  const nodes = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    ),
  );
  for (const el of nodes) {
    if (el.disabled || (el as HTMLInputElement).readOnly) continue;
    if (el instanceof HTMLInputElement) {
      const t = el.type?.toLowerCase() ?? "text";
      if (
        t === "password" ||
        t === "hidden" ||
        t === "submit" ||
        t === "button" ||
        t === "reset" ||
        t === "file" ||
        t === "image"
      ) {
        continue;
      }
    }
    const val = "value" in el ? String(el.value ?? "").trim() : "";
    if (!val || val.length > 8000) continue;
    const haystack = harvestAnyControl(el);
    if (!haystack.trim()) continue;
    const keyGuess = inferProfileFieldKey(haystack);
    if (!keyGuess) continue;
    fields[keyGuess] = val;
  }
  if (Object.keys(fields).length === 0) return;
  void dispatchToBackground({
    kind: "captureFormSubmit",
    origin: location.origin,
    fields,
  });
}

function listFillCandidates(skipHidden: boolean): { haystacks: string[] } {
  const targets = gatherEditableControls(document, skipHidden);
  return {
    haystacks: targets.map((el) => harvestHaystack(el).slice(0, 800)),
  };
}

function runFillPass(cmd: FillCommand): FillSummary {
  const targets = gatherEditableControls(document, cmd.skipHidden);
  const gem = cmd.geminiKeys;
  const useGemini =
    Array.isArray(gem) &&
    gem.length === targets.length &&
    gem.some((k) => k != null && String(cmd.profilePack[k as string] ?? "").trim());

  if (useGemini) {
    return runGeminiFillPass(cmd, targets, gem as (string | null)[]);
  }

  const plans = planAssignments(targets, cmd.profilePack, cmd.maxFields);
  let filled = 0;
  const notes: string[] = [];
  for (const plan of plans) {
    try {
      applyControlValue(plan.element, plan.value);
      filled += 1;
      if (cmd.highlight) flashOutline(plan.element);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }
  const skipped = Math.max(0, targets.length - filled);
  const summary = { filled, skipped, notes };
  showFillToast(filled, skipped);
  return summary;
}

function runGeminiFillPass(
  cmd: FillCommand,
  targets: Control[],
  geminiKeys: (string | null)[],
): FillSummary {
  const usedKeys = new Set<string>();
  let filled = 0;
  const notes: string[] = [];
  for (let i = 0; i < targets.length && filled < cmd.maxFields; i++) {
    const key = geminiKeys[i];
    if (key == null) continue;
    const val = cmd.profilePack[key];
    if (!val?.trim()) continue;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    const el = targets[i]!;
    try {
      applyControlValue(el, val);
      filled += 1;
      if (cmd.highlight) flashOutline(el);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }
  const skipped = Math.max(0, targets.length - filled);
  const summary = { filled, skipped, notes };
  showFillToast(filled, skipped);
  return summary;
}

type Control = HTMLInputElement | HTMLTextAreaElement;

function gatherEditableControls(doc: Document, skipHidden: boolean): Control[] {
  const out: Control[] = [];
  const seen = new WeakSet<Control>();

  function tryAdd(el: Control): void {
    if (seen.has(el)) return;
    if (el.disabled || el.readOnly) return;
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text";
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") return;
    if (skipHidden && shouldSkipAsHidden(el)) return;
    seen.add(el);
    out.push(el);
  }

  function collectFromRoot(root: Document | ShadowRoot): void {
    for (const el of Array.from(root.querySelectorAll<Control>("input, textarea"))) {
      tryAdd(el);
    }
    for (const node of Array.from(root.querySelectorAll("*"))) {
      if (node instanceof Element && node.shadowRoot) {
        collectFromRoot(node.shadowRoot);
      }
    }
  }

  collectFromRoot(doc);
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    let sub: Document | null = null;
    try {
      sub = frame.contentDocument;
    } catch {
      continue;
    }
    if (sub) collectFromRoot(sub);
  }
  return out;
}

/** When skipHidden is on, still keep required / aria-required fields unless truly display:none. */
function shouldSkipAsHidden(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return true;
  }
  const required =
    el.hasAttribute("required") ||
    el.getAttribute("aria-required") === "true" ||
    (el instanceof HTMLInputElement && el.required);
  if (required) {
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0;
}

function planAssignments(
  controls: Control[],
  profilePack: Record<string, string>,
  maxFields: number,
): { element: Control; value: string }[] {
  const usable = Object.entries(profilePack).filter(([, v]) => v.trim().length > 0);
  if (usable.length === 0) return [];

  const rows = controls.map((element, index) => ({
    index,
    element,
    blob: normalizeText(harvestHaystack(element)),
  }));

  const scored: { rowIndex: number; key: string; value: string; score: number }[] = [];
  for (const [key, value] of usable) {
    const needles = expandKeySynonyms(key);
    for (const row of rows) {
      const score = scoreHaystack(row.blob, needles, key);
      if (score > 0.18) scored.push({ rowIndex: row.index, key, value, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const usedRows = new Set<number>();
  const usedKeys = new Set<string>();
  const picks: { element: Control; value: string }[] = [];

  for (const s of scored) {
    if (picks.length >= maxFields) break;
    if (usedRows.has(s.rowIndex) || usedKeys.has(s.key)) continue;
    usedRows.add(s.rowIndex);
    usedKeys.add(s.key);
    picks.push({ element: rows[s.rowIndex]!.element, value: s.value });
  }
  return picks;
}

function flashOutline(el: HTMLElement): void {
  const previous = el.style.outline;
  el.style.outline = "2px solid #2f6feb";
  window.setTimeout(() => {
    el.style.outline = previous;
  }, 1400);
}
