export const VIZ_TYPES = ["line", "area", "bar", "column", "pie", "singlevalue", "table"] as const;

export type VizType = (typeof VIZ_TYPES)[number];

export interface SplunkDataSources {
  primary: {
    data: {
      fields: Array<{ name: string }>;
      columns: unknown[][];
    };
  };
}

export interface SSEChartEvent {
  vizType: VizType;
  dataSources: SplunkDataSources;
  width: number;
  height: number;
  spl?: string;
  earliest?: string;
  latest?: string;
}
