import React, { Suspense, lazy, Component, useRef, useState, useLayoutEffect } from "react";
import type { VizType, SplunkDataSources } from "../types";

declare const __SPLUNK_VIZ_AVAILABLE__: boolean;

const ChartJSFallback = lazy(() => import("./ChartJSRenderer"));

const SplunkVizRenderer =
  typeof __SPLUNK_VIZ_AVAILABLE__ !== "undefined" && __SPLUNK_VIZ_AVAILABLE__
    ? lazy(() =>
        import("./SplunkVizRenderer").catch(() => {
          return import("./ChartJSRenderer");
        })
      )
    : null;

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

interface ChartFallbackBoundaryProps {
  vizType: VizType;
  dataSources: SplunkDataSources;
  width: number;
  height: number;
  children: React.ReactNode;
}

interface ChartFallbackBoundaryState {
  hasError: boolean;
}

class ChartFallbackBoundary extends Component<
  ChartFallbackBoundaryProps,
  ChartFallbackBoundaryState
> {
  constructor(props: ChartFallbackBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ChartFallbackBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Suspense fallback={<ChartLoadingPlaceholder />}>
          <ChartJSFallback
            vizType={this.props.vizType}
            dataSources={this.props.dataSources}
            width={this.props.width}
            height={this.props.height}
          />
        </Suspense>
      );
    }
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

  const Renderer = SplunkVizRenderer ?? ChartJSFallback;

  return (
    <div ref={containerRef} className="w-full">
      {dims ? (
        <ChartFallbackBoundary
          vizType={props.vizType}
          dataSources={props.dataSources}
          width={dims.width}
          height={dims.height}
        >
          <Suspense fallback={<ChartLoadingPlaceholder />}>
            <Renderer
              vizType={props.vizType}
              dataSources={props.dataSources}
              width={dims.width}
              height={dims.height}
            />
          </Suspense>
        </ChartFallbackBoundary>
      ) : (
        <ChartLoadingPlaceholder />
      )}
    </div>
  );
}
