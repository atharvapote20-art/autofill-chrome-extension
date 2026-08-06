import { PROFILE_FIELD_PRESETS } from "./messages.js";

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_\-[\]/]+/g, " ")
    .replace(/[^a-z0-9@.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandKeySynonyms(key: string): string[] {
  const base = normalizeText(
    key.replace(/^snippet:/, "snippet ").replace(/^snippetid:/, "snippet "),
  );
  const table: Record<string, string[]> = {
    email: ["email", "e mail", "mail"],
    phone: ["phone", "mobile", "tel", "cell"],
    fullname: ["full name", "name", "complete name", "your name"],
    firstname: ["first name", "given name"],
    lastname: ["last name", "surname", "family name"],
    addressline1: ["address", "street", "address line 1", "line 1"],
    addressline2: ["address line 2", "apt", "suite", "unit"],
    city: ["city", "town"],
    region: ["state", "province", "region", "county"],
    postalcode: ["zip", "postal", "postcode"],
    country: ["country", "nation"],
    organization: ["company", "organization", "employer", "business"],
    website: ["website", "url", "homepage", "site"],
  };
  const compact = base.replace(/\s+/g, "");
  const extras = table[compact] ?? [];
  return [base, compact, ...extras];
}

export function scoreHaystack(haystack: string, needles: string[], rawKey: string): number {
  let best = 0;
  for (const n of needles) {
    if (!n) continue;
    if (haystack.includes(n)) best = Math.max(best, 0.55 + Math.min(0.45, n.length / 40));
    const tokens = n.split(" ").filter(Boolean);
    let hits = 0;
    for (const t of tokens) {
      if (t.length > 1 && haystack.includes(t)) hits += 1;
    }
    if (tokens.length) best = Math.max(best, (hits / tokens.length) * 0.5);
  }
  if (
    rawKey.startsWith("snippet") &&
    haystack.match(/message|comment|description|bio|details|feedback|inquiry/)
  ) {
    best += 0.08;
  }
  return Math.min(1, best);
}

/** Pick best preset profile field key for a label blob (reverse of fill matching). */
export function inferProfileFieldKey(haystackRaw: string): string | null {
  const haystack = normalizeText(haystackRaw);
  if (!haystack) return null;
  let bestKey: string | null = null;
  let bestScore = 0;
  for (const presetKey of PROFILE_FIELD_PRESETS) {
    const needles = expandKeySynonyms(presetKey);
    const s = scoreHaystack(haystack, needles, presetKey);
    if (s > bestScore) {
      bestScore = s;
      bestKey = presetKey;
    }
  }
  if (bestScore < 0.28 || !bestKey) return null;
  return bestKey;
}

const presetKeySet = new Set<string>(PROFILE_FIELD_PRESETS);

function needlesForCustomFieldKey(key: string): string[] {
  const spaced = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const parts = spaced
    .split(/\s+/)
    .map((p) => normalizeText(p))
    .filter((p) => p.length > 1);
  const full = normalizeText(spaced);
  const uniq = new Set<string>([full, full.replace(/\s+/g, ""), ...parts]);
  return [...uniq].filter(Boolean);
}

/** Rank saved profile fields that match this field's labels (for inline suggestions). */
export function listMatchingProfileSuggestions(
  haystackRaw: string,
  profileFields: Record<string, string>,
  max: number,
): Array<{ key: string; value: string; score: number }> {
  const haystack = normalizeText(haystackRaw);
  if (!haystack) return [];
  const out: Array<{ key: string; value: string; score: number }> = [];
  for (const [key, rawVal] of Object.entries(profileFields)) {
    const val = String(rawVal ?? "").trim();
    if (!val) continue;
    if (key.startsWith("snippet")) continue;
    let s: number;
    if (presetKeySet.has(key)) {
      const needles = expandKeySynonyms(key);
      s = scoreHaystack(haystack, needles, key);
    } else {
      const needles = needlesForCustomFieldKey(key);
      s = scoreHaystack(haystack, needles, key);
    }
    if (s >= 0.24) out.push({ key, value: val, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, max));
}
