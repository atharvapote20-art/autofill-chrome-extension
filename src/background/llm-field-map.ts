import { PROFILE_FIELD_PRESETS } from "../shared/messages.js";

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const KEY_HINT: Partial<Record<string, string>> = {
  fullName: "Person's full or legal name",
  firstName: "Given / first name",
  lastName: "Family / last name",
  email: "Email address",
  phone: "Phone / mobile number",
  addressLine1: "Street address line 1",
  addressLine2: "Apartment, suite, second line",
  city: "City",
  region: "State, province, or region",
  postalCode: "ZIP or postal code",
  country: "Country",
  organization: "Company or organization name",
  website: "Website URL",
};

function describeKey(key: string): string {
  if ((PROFILE_FIELD_PRESETS as readonly string[]).includes(key)) {
    return KEY_HINT[key] ?? `Standard field "${key}"`;
  }
  if (key.startsWith("snippet:") || key.startsWith("snippetId:")) {
    return `Snippet body for key ${key}`;
  }
  return `Custom profile field "${key}"`;
}

function buildFieldMapPrompt(haystacks: string[], allowedKeys: string[]): string {
  const keyLines = allowedKeys
    .map((k) => `- "${k}": ${describeKey(k)}`)
    .join("\n");
  const fieldLines = haystacks
    .map((h, i) => `${i}: ${h.replace(/\s+/g, " ").trim().slice(0, 600)}`)
    .join("\n");
  return `You help map web form controls to a user's saved profile keys.

Allowed profile keys (use these strings EXACTLY when assigning, or null):
${keyLines}

Form fields appear in fixed order (indices 0..${haystacks.length - 1}). Each line is "index: label and context text" from the page (names, placeholders, aria labels, autocomplete hints).

${fieldLines}

Return ONLY valid JSON: an object with key "assignments" whose value is an array of ${haystacks.length} items. Each item is either one of the allowed key strings in quotes or null. Same order as indices 0..${haystacks.length - 1}. Do not invent keys.`;
}

export function parseAssignmentsJson(text: string, len: number, allowed: Set<string>): (string | null)[] {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON object");
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { assignments?: unknown };
  if (!Array.isArray(parsed.assignments)) {
    throw new Error("Model JSON missing assignments array");
  }
  const raw = parsed.assignments.map((x) => (x === null || x === undefined ? null : String(x)));
  const out: (string | null)[] = [];
  for (let i = 0; i < len; i++) {
    const v = i < raw.length ? raw[i] : null;
    if (v == null || v === "" || v === "null") {
      out.push(null);
      continue;
    }
    if (!allowed.has(v)) {
      out.push(null);
      continue;
    }
    out.push(v);
  }
  return out;
}

function allowedKeysFromPack(profilePack: Record<string, string>): string[] {
  return Object.entries(profilePack)
    .filter(([, v]) => String(v ?? "").trim().length > 0)
    .map(([k]) => k);
}

export async function fetchGeminiFieldKeys(
  apiKey: string,
  haystacks: string[],
  profilePack: Record<string, string>,
): Promise<(string | null)[]> {
  if (!haystacks.length) return [];
  const allowedKeys = allowedKeysFromPack(profilePack);
  if (!allowedKeys.length) return haystacks.map(() => null);
  const allowed = new Set(allowedKeys);
  const prompt = buildFieldMapPrompt(haystacks, allowedKeys);
  const url = `${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  const part = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!part) {
    throw new Error("Gemini returned empty response");
  }
  return parseAssignmentsJson(part, haystacks.length, allowed);
}

export async function fetchGroqFieldKeys(
  apiKey: string,
  model: string,
  haystacks: string[],
  profilePack: Record<string, string>,
): Promise<(string | null)[]> {
  if (!haystacks.length) return [];
  const allowedKeys = allowedKeysFromPack(profilePack);
  if (!allowedKeys.length) return haystacks.map(() => null);
  const allowed = new Set(allowedKeys);
  const prompt = buildFieldMapPrompt(haystacks, allowedKeys);
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: model.trim() || "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You only output a single valid JSON object as specified. No markdown fences, no commentary.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  const part = data.choices?.[0]?.message?.content;
  if (!part) {
    throw new Error("Groq returned empty response");
  }
  return parseAssignmentsJson(part, haystacks.length, allowed);
}
