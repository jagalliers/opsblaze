import React, { useRef, useEffect } from "react";
import {
  Chart,
  BarController,
  LineController,
  PieController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  ArcElement,
  PointElement,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import type { VizType, SplunkDataSources } from "../types";

Chart.register(
  BarController,
  LineController,
  PieController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  ArcElement,
  PointElement,
  Filler,
  Legend,
  Tooltip
);

interface ChartJSRendererProps {
  vizType: VizType;
  dataSources: SplunkDataSources;
  width: number;
  height: number;
}

const PALETTE = [
  "rgba(99, 102, 241, 0.8)",
  "rgba(236, 72, 153, 0.8)",
  "rgba(34, 197, 94, 0.8)",
  "rgba(245, 158, 11, 0.8)",
  "rgba(14, 165, 233, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(239, 68, 68, 0.8)",
  "rgba(20, 184, 166, 0.8)",
];

const PALETTE_BORDER = PALETTE.map((c) => c.replace("0.8)", "1)"));

function hasData(dataSources: SplunkDataSources): boolean {
  const cols = dataSources?.primary?.data?.columns;
  return Array.isArray(cols) && cols.length > 0 && cols[0].length > 0;
}

function mapChartType(vizType: string): string {
  if (vizType === "column" || vizType === "bar") return "bar";
  if (vizType === "area") return "line";
  if (vizType === "pie") return "pie";
  return vizType;
}

function SingleValueCard({
  dataSources,
  width,
}: {
  dataSources: SplunkDataSources;
  width: number;
}) {
  const fields = dataSources.primary.data.fields;
  const columns = dataSources.primary.data.columns;
  const val = columns[columns.length - 1]?.[0];
  const label = fields.length > 1 ? fields[fields.length - 1].name : "";

  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-surface-1/50 p-6"
      style={{ width, minHeight: 100 }}
    >
      <div className="text-4xl font-bold text-accent">{val == null ? "\u2014" : String(val)}</div>
      {label && <div className="mt-1 text-sm text-gray-400">{label}</div>}
    </div>
  );
}

function DataTable({ dataSources, width }: { dataSources: SplunkDataSources; width: number }) {
  const { fields, columns } = dataSources.primary.data;
  const rowCount = columns[0]?.length ?? 0;
  const maxRows = Math.min(rowCount, 100);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700" style={{ maxWidth: width }}>
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-1/80 text-gray-400">
          <tr>
            {fields.map((f, i) => (
              <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }, (_, ri) => (
            <tr key={ri} className="border-t border-gray-800">
              {columns.map((col, ci) => (
                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-gray-300">
                  {col[ri] == null ? "" : String(col[ri])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rowCount > maxRows && (
        <div className="px-3 py-1.5 text-xs text-gray-500">
          {rowCount - maxRows} additional rows not shown
        </div>
      )}
    </div>
  );
}

function ChartCanvas({ vizType, dataSources, width, height }: ChartJSRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const { fields, columns } = dataSources.primary.data;
    const labels = columns[0].map((v) => (v == null ? "" : String(v)));

    const type = mapChartType(vizType) as "bar" | "line" | "pie";
    const isPie = type === "pie";
    const isArea = vizType === "area";
    const isHoriz = vizType === "bar";

    const datasets = fields.slice(1).map((f, i) => {
      const color = PALETTE[i % PALETTE.length];
      const border = PALETTE_BORDER[i % PALETTE_BORDER.length];
      const data = (columns[i + 1] ?? []).map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      });

      const cfg: Record<string, unknown> = {
        label: f.name,
        data,
        backgroundColor: isPie ? PALETTE.slice(0, data.length) : color,
        borderColor: isPie ? PALETTE_BORDER.slice(0, data.length) : border,
        borderWidth: isPie ? 1 : 2,
      };

      if (isArea) {
        cfg.fill = true;
        cfg.tension = 0.3;
      }
      if (type === "line" && !isArea) {
        cfg.fill = false;
        cfg.tension = 0.2;
      }

      return cfg;
    });

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: { labels, datasets: datasets as any },
      options: {
        indexAxis: isHoriz ? ("y" as const) : ("x" as const),
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: isPie ? 1.4 : 2.2,
        plugins: {
          legend: {
            display: datasets.length > 1 || isPie,
            position: isPie ? ("right" as const) : ("top" as const),
            labels: {
              font: { size: 11 },
              color: "rgba(209, 213, 219, 0.8)",
            },
          },
        },
        scales: isPie
          ? {}
          : {
              x: {
                ticks: {
                  font: { size: 10 },
                  maxRotation: 45,
                  color: "rgba(156, 163, 175, 0.8)",
                },
                grid: { color: "rgba(75, 85, 99, 0.3)" },
              },
              y: {
                ticks: {
                  font: { size: 10 },
                  color: "rgba(156, 163, 175, 0.8)",
                },
                beginAtZero: true,
                grid: { color: "rgba(75, 85, 99, 0.3)" },
              },
            },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [vizType, dataSources]);

  return (
    <div style={{ width, height }} className="p-2">
      <canvas ref={canvasRef} />
    </div>
  );
}

export default function ChartJSRenderer(props: ChartJSRendererProps) {
  const { vizType, dataSources, width, height } = props;

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

  if (vizType === "singlevalue") {
    return <SingleValueCard dataSources={dataSources} width={width} />;
  }

  if (vizType === "table") {
    return <DataTable dataSources={dataSources} width={width} />;
  }

  const isChartable = ["bar", "column", "line", "area", "pie"].includes(vizType);
  if (!isChartable) {
    return (
      <div
        className="flex items-center justify-center text-red-400 text-sm"
        style={{ width, height }}
      >
        Unsupported visualization type: {vizType}
      </div>
    );
  }

  return <ChartCanvas {...props} />;
}
