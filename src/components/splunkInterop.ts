import type { ComponentType } from "react";

/**
 * CJS interop shim for the proprietary @splunk/* packages.
 *
 * The @splunk/* packages are CommonJS modules compiled by esbuild (they set
 * `exports.__esModule` and `exports.default`). Rollup (Vite <= 6) unwrapped that
 * to expose the component as the ES default import. Vite 8's rolldown bundler —
 * and the dev pre-bundler — can instead surface it double-wrapped as
 * `{ default: Component, ...namedExports }`, so `import X from "..."` yields an
 * object, not the component. React then throws error #130 ("got: object") and
 * SplunkChart silently falls back to Chart.js.
 *
 * This helper peels off the extra default layer(s). It is intentionally
 * bundler-agnostic — it unwraps however many `{ default }` layers a given
 * bundler adds and is idempotent: if a bundler hands us the component directly
 * (a function), it is returned unchanged. Prefer this runtime unwrap over a
 * bundler-specific config flag (e.g. `legacy.inconsistentCjsInterop`); those
 * config-level fixes have repeatedly broken across bundler upgrades, which is
 * the root cause of this recurring bug (see AGENT_BOOTSTRAP / HANDOFF G9).
 */
export function interopDefault(mod: unknown): ComponentType<Record<string, unknown>> {
  let candidate: unknown = mod;
  while (
    candidate !== null &&
    typeof candidate === "object" &&
    "default" in candidate &&
    (candidate as { default: unknown }).default !== undefined
  ) {
    candidate = (candidate as { default: unknown }).default;
  }
  return candidate as ComponentType<Record<string, unknown>>;
}
