# Chrome Web Store listing — Secure Form Vault

Use this copy when creating the item in the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

Upload package:

```text
/Users/atharvpote/data/Project/autofill/secure-form-vault-0.3.0.zip
```

Privacy policy file to host (needs a public HTTPS URL):

```text
/Users/atharvpote/data/Project/autofill/store/privacy.html
```

Public privacy policy URLs:

```text
https://atharvapote20-art.github.io/autofill-chrome-extension/store/privacy.html
```

Fallback (works immediately from GitHub raw via jsDelivr):

```text
https://cdn.jsdelivr.net/gh/atharvapote20-art/autofill-chrome-extension@main/store/privacy.html
```

---

## Store fields

### Name
Secure Form Vault

### Short description (summary, ≤132 characters)
Locally encrypted profiles & snippets to autofill everyday web forms. Optional Gemini/Groq label matching.

### Detailed description
```
Secure Form Vault keeps form-fill profiles on your device — encrypted with your master password — and fills matching fields when you ask.

What you get
• Encrypted vault (AES-GCM + PBKDF2) for profiles and reusable snippets
• One-click “Fill this tab” from the popup, or Alt+Shift+F / Option+Shift+F
• Field assist suggestions when the vault is unlocked
• Optional learn-from-submit and save-on-blur helpers (off or configurable in Settings)
• Optional Smart fill via your own Gemini or Groq API key (labels only; off by default)
• Encrypted backup export/import

Privacy-minded by design
• Vault contents stay in Chrome extension storage on your machine
• Master password is not uploaded by the extension
• Smart fill (if enabled) sends field labels for matching — not your passphrase

How to start
1. Install and pin Secure Form Vault
2. Create a master password and add a profile in Settings
3. Open a form page → unlock → Fill this tab

Keyboard shortcut
Default: Alt+Shift+F (Option+Shift+F on Mac). If it is not assigned, open chrome://extensions/shortcuts and enable “Fill this tab with the last-used profile”. Details are also in Settings → Preferences.
```

### Category
Productivity

### Language
English

### Store icon
`dist/icons/icon-128.png` (128×128)

### Screenshots to capture (min 1; recommend 3)
1. Popup — unlock / quick fill
2. Options — profiles with readable field labels
3. A website form mid-fill + the top-right fill toast

Recommended size: **1280×800** or **640×400**

---

## Privacy practices (dashboard answers)

### Single purpose
Help users store encrypted personal/profile form data locally and autofill web forms on request.

### Privacy policy URL
Host `store/privacy.html` (GitHub Pages, your site, etc.), then paste that HTTPS URL here.

### Does the extension collect user data?
- **Personally identifiable information:** Yes — only if the user stores it in their vault (name, email, address, etc.). It is encrypted locally. You (the publisher) do not receive it on a server operated by this extension.
- **Health / financial / authentication data:** Generally no, unless the user chooses to type such values into profile fields themselves. Discourage storing passwords/payment cards in profiles.
- **Website content:** Yes, limited — field labels/DOM context needed to match and fill forms, processed in-browser; optional label text may be sent to Gemini/Groq if the user enables Smart fill.
- **Sell data to third parties:** No
- **Use data for purposes unrelated to the single purpose:** No

### Remote code
No remote code execution packages. Optional HTTPS calls only to Gemini/Groq APIs when the user opts in and supplies a key.

---

## Permission justifications (paste into dashboard)

| Permission / host | Justification |
| --- | --- |
| `storage` | Store the encrypted vault envelope, UI settings, optional API keys, and last-used profile id on the user’s device. |
| `activeTab` | Access the active tab when the user triggers fill from the extension UI. |
| `scripting` | Inject/re-attach the content script if needed so fill can run after navigation or a missing listener. |
| `alarms` | Schedule session timeout so the vault auto-locks after inactivity. |
| `http://*/*` and `https://*/*` | Read form field labels and fill matching inputs on websites the user chooses to autofill. Broad host access is required because forms appear across many sites. |
| `https://generativelanguage.googleapis.com/*` | Optional Smart fill via Google Gemini using the user’s own API key (field labels only). |
| `https://api.groq.com/*` | Optional Smart fill via Groq using the user’s own API key (field labels only). |

---

## Host privacy.html quickly (GitHub Pages example)

If this repo is on GitHub:

1. Commit `store/privacy.html`
2. Settings → Pages → Deploy from branch → `/docs` **or** keep `/store` and point Pages at `/ (root)` then use:
   `https://<user>.github.io/<repo>/store/privacy.html`
3. Paste that URL into the Web Store privacy policy field

Or upload `privacy.html` to any static host you control.
