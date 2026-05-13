import type { AssistPayload, ExtensionSettings } from "../shared/messages.js";
import { defaultExtensionSettings } from "../shared/messages.js";
import { dispatchToBackground } from "../shared/worker-gateway.js";
import type { HarvestableInput } from "./dom-harvest.js";
import { harvestHaystack } from "./dom-harvest.js";
import { applyControlValue } from "./field-value.js";

const SETTINGS_KEY = "sfvUiSettings";
const ROOT_ID = "__sfv_field_assist_root";
const STYLE_ID = "__sfv_field_assist_styles";

const KEY_LABELS: Record<string, string> = {
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country",
  organization: "Organization",
  website: "Website",
};

let assistEnabled = false;
let promptSaveEnabled = false;
let teardown: (() => void) | null = null;

let root: HTMLDivElement | null = null;
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let blurTimer: ReturnType<typeof setTimeout> | null = null;
let reposition: (() => void) | null = null;

function humanizeKey(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.35;
}
#${ROOT_ID} .sfv-fa-panel {
  pointer-events: auto;
  position: fixed;
  max-width: min(360px, calc(100vw - 16px));
  padding: 8px 10px;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0,0,0,.18);
  background: #1a1d24;
  color: #e8eaef;
  border: 1px solid rgba(255,255,255,.08);
}
#${ROOT_ID} .sfv-fa-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #9aa3b2;
  margin-bottom: 6px;
}
#${ROOT_ID} .sfv-fa-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
#${ROOT_ID} button.sfv-fa-btn {
  cursor: pointer;
  border: 1px solid rgba(255,255,255,.14);
  background: #2a3140;
  color: #e8eaef;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
}
#${ROOT_ID} button.sfv-fa-btn:hover {
  background: #354056;
}
#${ROOT_ID} button.sfv-fa-btn--primary {
  background: #2f6feb;
  border-color: #2f6feb;
}
#${ROOT_ID} button.sfv-fa-btn--primary:hover {
  background: #2566e8;
}
#${ROOT_ID} .sfv-fa-muted {
  font-size: 12px;
  color: #9aa3b2;
  margin-top: 6px;
}
`;
  document.documentElement.appendChild(style);
}

function ensureRoot(): HTMLDivElement {
  injectStyles();
  let el = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.setAttribute("data-sfv-assist", "1");
    document.documentElement.appendChild(el);
  }
  root = el;
  return el;
}

function clearRoot(): void {
  if (root) root.innerHTML = "";
}

function stopReposition(): void {
  if (reposition) {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    reposition = null;
  }
}

function placePanel(panel: HTMLElement, anchor: HTMLElement): void {
  const place = (): void => {
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const w = panel.offsetWidth || 280;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - w - margin));
    const below = r.bottom + 6;
    const spaceBelow = window.innerHeight - below;
    const h = panel.offsetHeight || 80;
    const top = spaceBelow >= h + margin ? below : Math.max(margin, r.top - h - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  place();
  stopReposition();
  reposition = () => place();
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
}

function hideAssistUi(): void {
  stopReposition();
  clearRoot();
}

function isTextLikeControl(t: EventTarget | null): t is HarvestableInput {
  if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return false;
  if (t.disabled || t.readOnly) return false;
  const type = t.type?.toLowerCase() ?? "text";
  if (
    type === "password" ||
    type === "hidden" ||
    type === "submit" ||
    type === "button" ||
    type === "reset" ||
    type === "file" ||
    type === "image" ||
    type === "checkbox" ||
    type === "radio" ||
    type === "range" ||
    type === "color"
  ) {
    return false;
  }
  return true;
}

function isOurUi(node: Node | null): boolean {
  if (!node || !(node instanceof Node)) return false;
  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest(`#${ROOT_ID}`));
}

async function fetchAssist(haystack: string): Promise<AssistPayload> {
  const res = await dispatchToBackground({ kind: "suggestForAssist", haystack });
  if (!res.ok || !("assist" in res)) {
    return { suggestions: [], inferredKey: null, storedForInferred: null };
  }
  return res.assist;
}

function renderSuggestions(target: HarvestableInput, assist: AssistPayload): void {
  if (!assist.suggestions.length) return;
  const host = ensureRoot();
  clearRoot();
  const panel = document.createElement("div");
  panel.className = "sfv-fa-panel";
  const title = document.createElement("div");
  title.className = "sfv-fa-title";
  title.textContent = "Saved in profile";
  const row = document.createElement("div");
  row.className = "sfv-fa-row";
  for (const s of assist.suggestions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sfv-fa-btn";
    btn.textContent = `Use “${truncate(s.value, 28)}” (${humanizeKey(s.key)})`;
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      applyControlValue(target, s.value);
      hideAssistUi();
      target.focus();
    });
    row.appendChild(btn);
  }
  panel.append(title, row);
  host.appendChild(panel);
  requestAnimationFrame(() => placePanel(panel, target));
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function renderSavePrompt(target: HarvestableInput, fieldKey: string, value: string): void {
  const host = ensureRoot();
  clearRoot();
  const panel = document.createElement("div");
  panel.className = "sfv-fa-panel";
  const title = document.createElement("div");
  title.className = "sfv-fa-title";
  title.textContent = "Save to profile?";
  const muted = document.createElement("div");
  muted.className = "sfv-fa-muted";
  muted.textContent = `Store this as ${humanizeKey(fieldKey)} on your active profile.`;
  const row = document.createElement("div");
  row.className = "sfv-fa-row";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "sfv-fa-btn sfv-fa-btn--primary";
  yes.textContent = "Save";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "sfv-fa-btn";
  no.textContent = "Dismiss";
  const close = (): void => {
    hideAssistUi();
  };
  yes.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void dispatchToBackground({ kind: "saveFieldToProfile", fieldKey, value }).finally(close);
  });
  no.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    close();
  });
  row.append(yes, no);
  panel.append(title, muted, row);
  host.appendChild(panel);
  requestAnimationFrame(() => placePanel(panel, target));
}

function scheduleSuggest(target: HarvestableInput): void {
  if (suggestTimer) clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    suggestTimer = null;
    if (document.activeElement !== target) return;
    void (async () => {
      const hay = harvestHaystack(target);
      const assist = await fetchAssist(hay);
      renderSuggestions(target, assist);
    })();
  }, 160);
}

function resolveSaveKey(assist: AssistPayload): string | null {
  if (assist.inferredKey) return assist.inferredKey;
  const top = assist.suggestions[0];
  if (top && top.score >= 0.3) return top.key;
  return null;
}

function baselineForKey(assist: AssistPayload, key: string): string {
  if (assist.inferredKey === key && assist.storedForInferred != null) {
    return assist.storedForInferred;
  }
  const hit = assist.suggestions.find((s) => s.key === key);
  return hit?.value.trim() ?? "";
}

function maybeSaveOnBlur(target: HarvestableInput): void {
  if (!promptSaveEnabled) return;
  void (async () => {
    const hay = harvestHaystack(target);
    const assist = await fetchAssist(hay);
    if (!target.isConnected) return;
    const v = target.value.trim();
    if (!v) return;
    const key = resolveSaveKey(assist);
    if (!key) return;
    const baseline = baselineForKey(assist, key).trim();
    if (v === baseline) return;
    renderSavePrompt(target, key, v);
  })();
}

function onFocusIn(ev: FocusEvent): void {
  if (!assistEnabled) return;
  if (!location.protocol.startsWith("http")) return;
  const t = ev.target;
  if (!isTextLikeControl(t)) return;
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
  scheduleSuggest(t);
}

function onFocusOut(ev: FocusEvent): void {
  if (suggestTimer) {
    clearTimeout(suggestTimer);
    suggestTimer = null;
  }
  const t = ev.target;
  if (!isTextLikeControl(t)) return;
  const rel = ev.relatedTarget as Node | null;
  if (isOurUi(rel)) return;

  hideAssistUi();

  if (!location.protocol.startsWith("http")) return;
  if (blurTimer) clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    blurTimer = null;
    maybeSaveOnBlur(t);
  }, 220);
}

function onPointerDownCapture(ev: PointerEvent): void {
  if (!root?.firstChild) return;
  const path = ev.composedPath();
  if (path.some((n) => n instanceof Element && n.closest(`#${ROOT_ID}`))) return;
  hideAssistUi();
}

function applyFlags(s: ExtensionSettings): void {
  assistEnabled = s.fieldAssistEnabled;
  promptSaveEnabled = s.promptSaveOnBlur;
}

function mount(): void {
  if (teardown) return;
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("pointerdown", onPointerDownCapture, true);
  teardown = () => {
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("pointerdown", onPointerDownCapture, true);
    if (suggestTimer) clearTimeout(suggestTimer);
    if (blurTimer) clearTimeout(blurTimer);
    suggestTimer = null;
    blurTimer = null;
    hideAssistUi();
    teardown = null;
  };
}

function unmount(): void {
  teardown?.();
}

/** Sync assist behavior from extension settings (vault may still be locked; worker returns empty assist). */
export function configureFieldAssist(settings: ExtensionSettings): void {
  applyFlags(settings);
  const want = settings.fieldAssistEnabled || settings.promptSaveOnBlur;
  if (!want) {
    unmount();
    return;
  }
  mount();
}

export async function readExtensionSettingsFromStorage(): Promise<ExtensionSettings> {
  const bag = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...defaultExtensionSettings(),
    ...(bag[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined),
  };
}
