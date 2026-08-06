/** Wire format between UI surfaces and the service worker. */

export type WorkerRequest =
  | { kind: "sessionGate" }
  | { kind: "status" }
  | { kind: "unlock"; passphrase: string }
  | { kind: "lock" }
  | { kind: "bootstrapVault"; passphrase: string }
  | { kind: "importVault"; envelope: VaultEnvelope; passphrase: string }
  | { kind: "applyVaultPatch"; patch: VaultPatch }
  | { kind: "fillActiveTab"; profileId: string }
  | { kind: "captureFormSubmit"; origin: string; fields: Record<string, string> }
  | { kind: "readSettings" }
  | { kind: "writeSettings"; settings: ExtensionSettings }
  | { kind: "peekEncryptedVault" }
  | { kind: "vaultDocumentSnapshot" }
  | { kind: "suggestForAssist"; haystack: string }
  | { kind: "saveFieldToProfile"; fieldKey: string; value: string };

export type AssistPayload = {
  suggestions: Array<{ key: string; value: string; score: number }>;
  inferredKey: string | null;
  storedForInferred: string | null;
};

export type VaultPatch =
  | { op: "upsertProfile"; profile: Profile }
  | { op: "removeProfile"; profileId: string }
  | { op: "upsertSnippet"; snippet: Snippet }
  | { op: "removeSnippet"; snippetId: string };

export type WorkerResponse =
  | { ok: true; unlocked: boolean }
  | { ok: true; status: SessionStatus }
  | { ok: true; settings: ExtensionSettings }
  | { ok: true; fillSummary: FillSummary }
  | { ok: true; saved: true }
  | { ok: true; vaultEnvelope: VaultEnvelope }
  | { ok: true; document: VaultDocument }
  | { ok: true; assist: AssistPayload }
  | { ok: false; code: WorkerErrorCode; detail?: string };

export type WorkerErrorCode =
  | "WRONG_PASSPHRASE"
  | "NO_VAULT"
  | "CORRUPT_PAYLOAD"
  | "LOCKED"
  | "BAD_TAB"
  | "INJECT_FAILED"
  | "INTERNAL";

export type SessionStatus = {
  hasVault: boolean;
  unlocked: boolean;
  profileSummaries: ProfileSummary[];
  defaultProfileId: string | null;
};

export type ProfileSummary = { id: string; name: string; isDefault: boolean };

export type FillSummary = { filled: number; skipped: number; notes: string[] };

export type SmartFillProvider = "none" | "gemini" | "groq";

export type ExtensionSettings = {
  highlightFilledFields: boolean;
  /** Minimum 1 minute (Chrome alarms granularity). */
  sessionTimeoutMinutes: number;
  skipHiddenFields: boolean;
  maxFieldsPerFill: number;
  /**
   * When on, submitting a form on http(s) pages merges recognized non-password
   * fields into the active profile (vault must be unlocked).
   */
  learnFromSubmittedForms: boolean;
  /** Show floating saved values when focusing fields (vault unlocked). */
  fieldAssistEnabled: boolean;
  /** After editing a field, offer to save into profile when it differs from stored. */
  promptSaveOnBlur: boolean;
  /**
   * Optional LLM to map field labels to profile keys for "Fill this tab".
   * Label text is sent to the provider; values are applied locally only.
   */
  smartFillProvider: SmartFillProvider;
  /** Google AI Studio / Gemini API key (local storage only). */
  geminiApiKey: string;
  /** Groq API key (local storage only). */
  groqApiKey: string;
  /** Groq chat model id, e.g. llama-3.3-70b-versatile */
  groqModel: string;
};

export const defaultExtensionSettings = (): ExtensionSettings => ({
  highlightFilledFields: true,
  sessionTimeoutMinutes: 15,
  skipHiddenFields: true,
  maxFieldsPerFill: 48,
  learnFromSubmittedForms: false,
  fieldAssistEnabled: true,
  promptSaveOnBlur: true,
  smartFillProvider: "none",
  geminiApiKey: "",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",
});

export type VaultEnvelope = {
  format: "sfv-aes-gcm-pbkdf2";
  schemaVersion: number;
  iv: string;
  salt: string;
  ciphertext: string;
  pbkdf2Iterations: number;
};

export type Profile = {
  id: string;
  name: string;
  isDefault: boolean;
  fields: Record<string, string>;
};

export type Snippet = {
  id: string;
  title: string;
  body: string;
  tags: string[];
};

export type VaultDocument = {
  schemaVersion: number;
  profiles: Profile[];
  snippets: Snippet[];
};

export const PROFILE_FIELD_PRESETS: readonly string[] = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
  "organization",
  "website",
] as const;
