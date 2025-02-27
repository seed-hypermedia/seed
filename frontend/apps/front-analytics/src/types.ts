export interface MemoryStats {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface CPUStats {
  user: number;
  system: number;
}

export interface PeriodicStat {
  type: "Memory" | "CPU";
  data: MemoryStats | CPUStats;
  timestamp: string;
}

export interface MetricsData {
  initialStats: {
    Memory: MemoryStats;
    CPU: CPUStats;
  };
  periodicStats: PeriodicStat[];
  totalRuntime: number;
}
