import React, { Suspense, lazy, Component, useRef, useState, useLayoutEffect } from "react";
import type { VizType, SplunkDataSources } from "../types";

declare const __SPLUNK_VIZ_AVAILABLE__: boolean;

const ChartJSFallback = lazy(() => import("./ChartJSRenderer"));

const Renderer =
  typeof __SPLUNK_VIZ_AVAILABLE__ !== "undefined" && __SPLUNK_VIZ_AVAILABLE__
    ? lazy(() =>
        import("./SplunkVizRenderer").catch(() => {
          return import("./ChartJSRenderer");
        })
      )
    : ChartJSFallback;

const SINGLEVALUE_MAX_HEIGHT = 160;

interface SplunkChartProps {
  vizType: VizType;
  dataSources: SplunkDataSources;
  width: number;
  height: number;
}

function clampDimensions(
  vizType: VizType,
  serverWidth: number,
  serverHeight: number,
  containerWidth: number
): { width: number; height: number } {
  const w = Math.min(serverWidth, containerWidth);
  const scale = w / serverWidth;
  let h = Math.round(serverHeight * scale);

  if (vizType === "singlevalue") {
    h = Math.min(h, SINGLEVALUE_MAX_HEIGHT);
  }

  return { width: w, height: h };
}

function ChartLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center py-12">
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

function ChartErrorFallback() {
  return (
    <div className="flex items-center justify-center text-gray-500 text-sm border border-gray-700 rounded-lg py-6">
      Chart failed to load — try refreshing the page.
    </div>
  );
}

interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ChartErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error) {
    // Errors are handled by the fallback UI
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function SplunkChart(props: SplunkChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => setContainerWidth(el.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dims =
    containerWidth !== null
      ? clampDimensions(props.vizType, props.width, props.height, containerWidth)
      : null;

  return (
    <div ref={containerRef} className="w-full">
      <ChartErrorBoundary fallback={<ChartErrorFallback />}>
        {dims ? (
          <Suspense fallback={<ChartLoadingPlaceholder />}>
            <Renderer
              vizType={props.vizType}
              dataSources={props.dataSources}
              width={dims.width}
              height={dims.height}
            />
          </Suspense>
        ) : (
          <ChartLoadingPlaceholder />
        )}
      </ChartErrorBoundary>
    </div>
  );
}
