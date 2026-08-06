const TOAST_HOST_ID = "__sfv_fill_toast_host";
const TOAST_STYLE_ID = "__sfv_fill_toast_styles";

function ensureStyles(): void {
  if (document.getElementById(TOAST_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = TOAST_STYLE_ID;
  style.textContent = `
#${TOAST_HOST_ID} {
  all: initial;
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  pointer-events: none;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
#${TOAST_HOST_ID} .sfv-toast {
  pointer-events: auto;
  min-width: 200px;
  max-width: min(320px, calc(100vw - 32px));
  padding: 12px 14px;
  border-radius: 12px;
  background: #0f172a;
  color: #f8fafc;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.28);
  border: 1px solid rgba(148, 163, 184, 0.35);
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 160ms ease, transform 160ms ease;
}
#${TOAST_HOST_ID} .sfv-toast.is-in {
  opacity: 1;
  transform: translateY(0);
}
#${TOAST_HOST_ID} .sfv-toast__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
#${TOAST_HOST_ID} .sfv-toast__detail {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: #cbd5e1;
}
#${TOAST_HOST_ID} .sfv-toast--ok {
  border-color: rgba(34, 197, 94, 0.45);
}
#${TOAST_HOST_ID} .sfv-toast--warn {
  border-color: rgba(245, 158, 11, 0.5);
}
`;
  document.documentElement.appendChild(style);
}

function host(): HTMLDivElement {
  ensureStyles();
  let el = document.getElementById(TOAST_HOST_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = TOAST_HOST_ID;
    document.documentElement.appendChild(el);
  }
  return el;
}

export function showFillToast(filled: number, skipped: number): void {
  const root = host();
  root.replaceChildren();

  const card = document.createElement("div");
  card.className = `sfv-toast ${filled > 0 ? "sfv-toast--ok" : "sfv-toast--warn"}`;
  card.setAttribute("role", "status");

  const title = document.createElement("p");
  title.className = "sfv-toast__title";
  const detail = document.createElement("p");
  detail.className = "sfv-toast__detail";

  if (filled === 0 && skipped === 0) {
    title.textContent = "Nothing to fill";
    detail.textContent = "No editable fields found on this page.";
  } else if (filled === 0) {
    title.textContent = "No fields filled";
    detail.textContent = `Found ${skipped} field${skipped === 1 ? "" : "s"}, but none matched your profile.`;
  } else if (skipped === 0) {
    title.textContent = `Filled ${filled} field${filled === 1 ? "" : "s"}`;
    detail.textContent = "All matched fields were updated.";
  } else {
    title.textContent = `Filled ${filled} field${filled === 1 ? "" : "s"}`;
    detail.textContent = `${skipped} other field${skipped === 1 ? "" : "s"} had no strong match.`;
  }

  card.append(title, detail);
  root.appendChild(card);
  requestAnimationFrame(() => card.classList.add("is-in"));

  window.setTimeout(() => {
    card.classList.remove("is-in");
    window.setTimeout(() => {
      if (card.parentElement === root) card.remove();
      if (!root.childElementCount) root.remove();
    }, 180);
  }, 3400);
}
