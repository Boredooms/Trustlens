// Pairing form used by both popup and options: code → POST /auth/extension/exchange (via the worker).
import { COPY } from "./copy";
import { send, type PairingState } from "./messages";

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "desktop";
  return `Chrome on ${os}`;
}

export function wirePairForm(
  form: HTMLFormElement,
  input: HTMLInputElement,
  errorEl: HTMLElement,
  onPaired: (state: PairingState) => void,
): void {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    errorEl.textContent = "";
    if (button) {
      button.disabled = true;
      button.textContent = COPY.pair.working;
    }
    const code = input.value;
    const reply = await send({ type: "PAIR", code, deviceName: deviceName() });
    if (button) {
      button.disabled = false;
      button.textContent = COPY.pair.submit;
    }
    if (reply.ok) {
      input.value = "";
      onPaired(reply.data);
      return;
    }
    errorEl.textContent = reply.error.code === "INVALID_CODE" ? COPY.pair.invalidCode : COPY.pair.failed;
  });
}
