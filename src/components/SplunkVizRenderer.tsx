// @ts-nocheck -- This file is only imported when @splunk/visualizations is installed (build-time detection).
import React, { Suspense, lazy } from "react";
import SplunkThemeProvider from "@splunk/themes/SplunkThemeProvider";
import type { VizType, SplunkDataSources } from "../types";

function lazyWithRetry(
  factory: () => Promise<{ default: React.ComponentType<any> }>
): React.LazyExoticComponent<React.ComponentType<any>> {
  return lazy(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await factory();
      } catch (err) {
        if (import.meta.env.DEV)
          console.error(`[SplunkViz] import attempt ${attempt + 1}/3 failed:`, err);
        if (attempt === 2) throw new Error("Chart component failed to load");
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw new Error("Chart component failed to load");
  });
}

const vizComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  line: lazyWithRetry(() => import("@splunk/visualizations/Line")),
  area: lazyWithRetry(() => import("@splunk/visualizations/Area")),
  bar: lazyWithRetry(() => import("@splunk/visualizations/Bar")),
  column: lazyWithRetry(() => import("@splunk/visualizations/Column")),
  pie: lazyWithRetry(() => import("@splunk/visualizations/Pie")),
  singlevalue: lazyWithRetry(() => import("@splunk/visualizations/SingleValue")),
  table: lazyWithRetry(() => import("@splunk/visualizations/Table")),
};

interface SplunkVizRendererProps {
  vizType: VizType;
  dataSources: SplunkDataSources;
  width: number;
  height: number;
}

function ChartLoadingPlaceholder({ width, height }: { width: number; height: number }) {
  return (
    <div className="flex items-center justify-center" style={{ width, height }}>
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <svg className="animate-spin h-4 w-4 text-accent/50" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading chart...
      </div>
    </div>
  );
}

function hasData(dataSources: SplunkDataSources): boolean {
  const cols = dataSources?.primary?.data?.columns;
  return Array.isArray(cols) && cols.length > 0 && cols[0].length > 0;
}

function SplunkVizInner({ vizType, dataSources, width, height }: SplunkVizRendererProps) {
  const VizComponent = vizComponents[vizType];

  if (!VizComponent) {
    return (
      <div
        className="flex items-center justify-center text-red-400 text-sm"
        style={{ width, height }}
      >
        Unsupported visualization type: {vizType}
      </div>
    );
  }

  if (!hasData(dataSources)) {
    return (
      <div
        className="flex items-center justify-center text-gray-500 text-sm border border-gray-700 rounded-lg"
        style={{ width, height: Math.min(height, 80) }}
      >
        No data returned for this query.
      </div>
    );
  }

  return (
    <div style={{ width, height }} className="p-2">
      <Suspense fallback={<ChartLoadingPlaceholder width={width} height={height} />}>
        <VizComponent dataSources={dataSources} width={width - 16} height={height - 16} />
      </Suspense>
    </div>
  );
}

export default function SplunkVizRenderer(props: SplunkVizRendererProps) {
  return (
    <SplunkThemeProvider family="enterprise" colorScheme="dark">
      <SplunkVizInner {...props} />
    </SplunkThemeProvider>
  );
}
