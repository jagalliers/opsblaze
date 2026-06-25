// @ts-nocheck -- imports optional, untyped @splunk/* packages and Node built-ins
// that are not in the client tsconfig's lib; this file is exercised by vitest,
// not the production build.
/**
 * @vitest-environment jsdom
 *
 * Regression guard for the recurring Splunk-viz CJS-interop breakage
 * (HANDOFF G9). The proprietary @splunk/* packages are CommonJS and, depending
 * on the bundler, surface their component as a double-wrapped default export.
 * When that happens unguarded, React throws error #130 and SplunkChart silently
 * falls back to Chart.js — the exact symptom users have hit after every bundler
 * upgrade.
 *
 * Part 1 (pure unwrap) always runs and locks in interopDefault's contract.
 * Part 2 runs ONLY when @splunk/visualizations is installed — it imports the
 * REAL Splunk modules the way the app does and asserts each default export
 * resolves to a component *function*, not an object. CI never installs the
 * proprietary packages, so Part 2 is a no-op there; but it fires on any
 * developer/release machine that has Splunk installed — which is precisely where
 * the next bundler upgrade would otherwise silently re-break rendering.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { interopDefault } from "../splunkInterop";

const here = path.dirname(fileURLToPath(import.meta.url));
const splunkInstalled = fs.existsSync(
  path.resolve(here, "../../../node_modules/@splunk/visualizations")
);

describe("interopDefault (pure unwrap)", () => {
  function Comp() {
    return null;
  }

  it("returns a plain function component unchanged", () => {
    expect(interopDefault(Comp)).toBe(Comp);
  });

  it("unwraps a single { default } layer", () => {
    expect(interopDefault({ default: Comp })).toBe(Comp);
  });

  it("unwraps the double-wrapped { default: { default } } rolldown shape", () => {
    expect(interopDefault({ default: { default: Comp } })).toBe(Comp);
  });

  it("unwraps while named exports sit alongside default", () => {
    expect(interopDefault({ default: Comp, config: {}, themes: {} })).toBe(Comp);
  });

  it("stops at a function even when it carries its own .default property", () => {
    const withProps = Object.assign(
      function Inner() {
        return null;
      },
      { default: Comp }
    );
    expect(interopDefault(withProps)).toBe(withProps);
  });

  it("returns the value unchanged when there is no default to unwrap", () => {
    const obj = { config: {} };
    expect(interopDefault(obj)).toBe(obj);
  });
});

const describeInstalled = splunkInstalled ? describe : describe.skip;

describeInstalled("real @splunk default exports resolve to components", () => {
  // jsdom omits a few browser globals that @splunk's charting deps (uplot,
  // ResizeObserver) touch at module-eval time. Real browsers provide these, so
  // stub them just enough to let the modules import; we only inspect the export
  // shape here, we do not render.
  beforeAll(() => {
    if (typeof window.matchMedia !== "function") {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
    if (typeof globalThis.ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  // Importing SplunkVizRenderer installs the Splunk i18n window shims that the
  // viz modules expect to exist when evaluated.
  it("theme provider default export unwraps to a function", async () => {
    await import("../SplunkVizRenderer");
    const mod = await import("@splunk/themes/SplunkThemeProvider");
    expect(typeof interopDefault(mod)).toBe("function");
  });

  const vizLoaders: Array<[string, () => Promise<unknown>]> = [
    ["Line", () => import("@splunk/visualizations/Line")],
    ["Area", () => import("@splunk/visualizations/Area")],
    ["Bar", () => import("@splunk/visualizations/Bar")],
    ["Column", () => import("@splunk/visualizations/Column")],
    ["Pie", () => import("@splunk/visualizations/Pie")],
    ["SingleValue", () => import("@splunk/visualizations/SingleValue")],
    ["Table", () => import("@splunk/visualizations/Table")],
  ];

  it.each(vizLoaders)("%s default export unwraps to a function", async (_name, load) => {
    await import("../SplunkVizRenderer");
    const mod = await load();
    expect(typeof interopDefault(mod)).toBe("function");
  });
});
