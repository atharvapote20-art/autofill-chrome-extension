export type HarvestableInput = HTMLInputElement | HTMLTextAreaElement;
export type HarvestableControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Document or shadow root where the control lives (for label / id queries). */
export function queryScope(el: Node): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : document;
}

export function cssEscapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function queryById(scope: Document | ShadowRoot, id: string): Element | null {
  if (!id.trim()) return null;
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    try {
      return scope.querySelector(`#${CSS.escape(id)}`);
    } catch {
      return null;
    }
  }
  return scope.querySelector(`[id="${cssEscapeAttr(id)}"]`);
}

export function harvestHaystack(el: HarvestableInput): string {
  const scope = queryScope(el);
  const bits: string[] = [];
  if (el.id) bits.push(el.id);
  if (el.name) bits.push(el.name);
  const auto = el.getAttribute("autocomplete");
  if (auto) bits.push(auto);
  if (el.getAttribute("placeholder")) bits.push(el.getAttribute("placeholder")!);
  if (el.getAttribute("aria-label")) bits.push(el.getAttribute("aria-label")!);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const ref = queryById(scope, id);
      if (ref?.textContent) bits.push(ref.textContent);
    }
  }
  if (el.id) {
    const lab = scope.querySelector(`label[for="${cssEscapeAttr(el.id)}"]`);
    if (lab?.textContent) bits.push(lab.textContent);
  }
  const parentLab = el.closest("label");
  if (parentLab?.textContent) bits.push(parentLab.textContent);
  return bits.join(" \n ");
}

export function harvestAnyControl(el: HarvestableControl): string {
  const scope = queryScope(el);
  if (el instanceof HTMLSelectElement) {
    const bits: string[] = [];
    if (el.id) bits.push(el.id);
    if (el.name) bits.push(el.name);
    const auto = el.getAttribute("autocomplete");
    if (auto) bits.push(auto);
    if (el.getAttribute("aria-label")) bits.push(el.getAttribute("aria-label")!);
    if (el.id) {
      const lab = scope.querySelector(`label[for="${cssEscapeAttr(el.id)}"]`);
      if (lab?.textContent) bits.push(lab.textContent);
    }
    const parentLab = el.closest("label");
    if (parentLab?.textContent) bits.push(parentLab.textContent);
    return bits.join(" \n ");
  }
  return harvestHaystack(el);
}
