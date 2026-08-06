import type { WorkerRequest, WorkerResponse } from "./messages.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoReceivingEnd(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Receiving end does not exist|Could not establish connection/i.test(msg);
}

export async function dispatchToBackground(message: WorkerRequest): Promise<WorkerResponse> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await chrome.runtime.sendMessage(message);
      if (raw == null) {
        return {
          ok: false,
          code: "INTERNAL",
          detail:
            "No response from the extension background. Reload the extension on chrome://extensions, then reopen this page.",
        };
      }
      return raw as WorkerResponse;
    } catch (e) {
      const last = attempt === maxAttempts - 1;
      if (!last && isNoReceivingEnd(e)) {
        await sleep(80 + attempt * 120);
        continue;
      }
      return {
        ok: false,
        code: "INTERNAL",
        detail:
          e instanceof Error
            ? e.message
            : "Message to background failed. On chrome://extensions click Reload for this extension, close this tab, and open Settings again.",
      };
    }
  }
  return {
    ok: false,
    code: "INTERNAL",
    detail: "Could not reach the background worker after several tries. Reload the extension.",
  };
}
