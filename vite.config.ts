import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

function splunkVizAvailable(): boolean {
  return fs.existsSync(
    path.resolve(__dirname, "node_modules", "@splunk", "visualizations")
  );
}

const hasSplunk = splunkVizAvailable();

/**
 * Rollup's CJS plugin strips `__esModule` when converting @splunk/charting-bundle
 * from CJS to ESM. The @splunk/visualizations components (compiled by esbuild)
 * use `__toESM(require("@splunk/charting-bundle"))` which checks `__esModule` to
 * decide whether to wrap in an extra `{ default: ... }` layer. Without it, the
 * exports get double-wrapped and `extractChartReadyData` becomes unreachable.
 *
 * This plugin intercepts the charting bundle with a virtual ESM proxy that
 * re-exports the default and explicitly includes `__esModule` as a named export.
 */
function splunkChartingInterop(): Plugin {
  const PROXY_ID = "\0splunk-charting-proxy";
  const realPath = path.resolve(
    __dirname,
    "node_modules/@splunk/charting-bundle/index.js"
  );

  return {
    name: "splunk-charting-interop",
    enforce: "pre",
    resolveId(source) {
      if (source === "@splunk/charting-bundle") {
        return PROXY_ID;
      }
    },
    load(id) {
      if (id === PROXY_ID) {
        return [
          `import _bundle from ${JSON.stringify(realPath)};`,
          `export default _bundle;`,
          `export const __esModule = true;`,
        ].join("\n");
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ...(hasSplunk ? [splunkChartingInterop()] : [])],
  define: {
    __SPLUNK_VIZ_AVAILABLE__: JSON.stringify(hasSplunk),
  },
  resolve: {
    alias: {
      ...(hasSplunk
        ? {
            "@splunk/visualization-context/ZoomContext": path.resolve(
              __dirname,
              "src/stubs/ZoomContext.ts"
            ),
          }
        : {}),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: hasSplunk
      ? [
          "@splunk/charting-bundle",
          "@splunk/themes",
        ]
      : [],
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
