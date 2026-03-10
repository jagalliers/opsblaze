import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

function splunkVizAvailable(): boolean {
  return fs.existsSync(
    path.resolve(__dirname, "node_modules", "@splunk", "visualizations")
  );
}

const hasSplunk = splunkVizAvailable();

export default defineConfig({
  plugins: [react()],
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
          "@splunk/visualizations",
          "@splunk/visualization-context",
          "@splunk/visualization-themes",
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
