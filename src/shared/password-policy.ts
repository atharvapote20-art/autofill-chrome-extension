/**
 * Master password rules for new vault creation (signup-style policy).
 * Unlock accepts any passphrase created earlier.
 */

const MIN_LENGTH = 8;
/** Shown in hints; 8 is enforced, longer is recommended. */
export const RECOMMENDED_PASSWORD_LENGTH = 10;

const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password123",
    "123456",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty",
    "qwerty123",
    "abc123",
    "letmein",
    "welcome",
    "welcome1",
    "admin",
    "admin123",
    "monkey",
    "dragon",
    "master",
    "sunshine",
    "princess",
    "football",
    "iloveyou",
    "trustno1",
    "654321",
    "superman",
    "qazwsx",
    "michael",
    "login",
    "passw0rd",
    "p@ssw0rd",
  ].map((s) => s.toLowerCase()),
);

function hasLongRepeatedRun(s: string): boolean {
  return /(.)\1{4,}/.test(s);
}

/** Any contiguous letters or digits of length >= minLen that are strictly +1 or -1 steps. */
function hasStrictRun(s: string, minLen: number): boolean {
  const re = /[a-zA-Z]+|\d+/g;
  let m: RegExpExecArray | null;
  const lower = s.toLowerCase();
  while ((m = re.exec(lower)) !== null) {
    const chunk = m[0];
    if (chunk.length < minLen) continue;
    for (let start = 0; start <= chunk.length - minLen; start++) {
      const sub = chunk.slice(start, start + minLen);
      let asc = true;
      let desc = true;
      for (let i = 1; i < sub.length; i++) {
        if (sub.charCodeAt(i) !== sub.charCodeAt(i - 1) + 1) asc = false;
        if (sub.charCodeAt(i) !== sub.charCodeAt(i - 1) - 1) desc = false;
      }
      if (asc || desc) return true;
    }
  }
  return false;
}

function containsLocalPart(password: string, email: string): boolean {
  const at = email.indexOf("@");
  const local = (at > 0 ? email.slice(0, at) : email).toLowerCase().trim();
  if (local.length < 3) return false;
  const low = password.toLowerCase();
  return low.includes(local);
}

function containsFullEmail(password: string, email: string): boolean {
  const e = email.toLowerCase().trim();
  if (e.length < 5) return false;
  return password.toLowerCase().includes(e);
}

export type MasterPasswordContext = {
  /** If set, password must not contain this email (or its local-part). */
  email?: string;
  /** If set, password must not contain this username (case-insensitive). */
  username?: string;
};

/**
 * @returns error message, or null if acceptable for a new vault.
 * Re-use of previous passwords is not tracked here (no password-change flow yet).
 */
export function validateNewMasterPassword(
  password: string,
  ctx?: MasterPasswordContext,
): string | null {
  const p = password.normalize("NFKC").trim();
  if (!p.trim()) return "Enter a master password.";

  if (p.length < MIN_LENGTH) {
    return `Use at least ${MIN_LENGTH} characters (${RECOMMENDED_PASSWORD_LENGTH}–12+ recommended).`;
  }

  if (!/[A-Z]/.test(p)) return "Include at least one uppercase letter (A–Z).";
  if (!/[a-z]/.test(p)) return "Include at least one lowercase letter (a–z).";
  if (!/[0-9]/.test(p)) return "Include at least one number (0–9).";
  if (!SPECIAL_RE.test(p)) {
    return "Include at least one special character (e.g. @ # $ % & * !).";
  }

  const low = p.toLowerCase();
  if (COMMON_PASSWORDS.has(low)) {
    return "This password is too common. Choose a stronger one.";
  }
  if (/^(.)\1+$/.test(p)) {
    return "Avoid repeated patterns (same character throughout).";
  }
  if (hasLongRepeatedRun(p)) {
    return "Avoid long repeated characters (e.g. aaaaa).";
  }
  if (hasStrictRun(p, 6)) {
    return "Avoid long sequential patterns (e.g. 123456 or abcdef).";
  }
  if (/^[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]+$/.test(p)) {
    return "Include letters as well as numbers and symbols.";
  }

  if (ctx?.email) {
    if (containsFullEmail(p, ctx.email) || containsLocalPart(p, ctx.email)) {
      return "Password must not contain your email (or the part before @).";
    }
  }
  if (ctx?.username && ctx.username.trim().length >= 3) {
    const u = ctx.username.trim().toLowerCase();
    if (p.toLowerCase().includes(u)) {
      return "Password must not contain your username.";
    }
  }

  return null;
}
