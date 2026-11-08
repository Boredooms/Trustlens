import "@testing-library/jest-dom/vitest";

// Node >= 22 ships its own fetch/Request (undici). Under jsdom, `AbortController` is jsdom's, and
// undici rejects a jsdom AbortSignal ("Expected signal to be an instance of AbortSignal"). React
// Router builds a Request with such a signal on every navigation. Request cancellation is not
// under test, so the test-only Request ignores `signal`. Production code is unaffected.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init && "signal" in init) {
      const { signal: _ignored, ...rest } = init;
      super(input, rest);
    } else {
      super(input, init);
    }
  }
} as typeof Request;
