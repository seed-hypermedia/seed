import {CPUStats, MemoryStats, MetricsData, PeriodicStat} from "../types";

export function parseMetricsFile(content: string): MetricsData {
  const lines = content.split("\n");
  let initialStats: {Memory?: MemoryStats; CPU?: CPUStats} = {};
  const periodicStats: PeriodicStat[] = [];
  let totalRuntime = 0;
  let currentTimestamp = new Date();

  lines.forEach((line) => {
    // Skip non-metrics lines
    if (!line.includes("[STATS-") && !line.includes("[PERF]")) return;

    try {
      if (line.includes("[STATS-INITIAL]")) {
        const type = line.includes("Memory:") ? "Memory" : "CPU";
        const jsonStart = line.indexOf("{");
        if (jsonStart === -1) return;
        const jsonStr = line.substring(jsonStart);
        const data = JSON.parse(jsonStr);
        initialStats[type] = data;
      } else if (line.includes("[STATS-PERIODIC]")) {
        const type = line.includes("Memory:") ? "Memory" : "CPU";
        const jsonStart = line.indexOf("{");
        if (jsonStart === -1) return;
        const jsonStr = line.substring(jsonStart);
        const data = JSON.parse(jsonStr);

        periodicStats.push({
          type,
          data,
          timestamp: currentTimestamp.toISOString(),
        });

        // Increment timestamp by 1 second for next periodic stat
        currentTimestamp = new Date(currentTimestamp.getTime() + 1000);
      } else if (line.includes("[STATS-FINAL]")) {
        const runtimeMatch = line.match(/Total runtime: (\d+)/);
        if (runtimeMatch) {
          totalRuntime = parseInt(runtimeMatch[1], 10);
        }
      }
    } catch (error) {
      console.error("Error parsing line:", line, error);
      // Continue to next line
    }
  });

  if (!initialStats.Memory || !initialStats.CPU) {
    throw new Error("Missing required initial stats");
  }

  return {
    initialStats: {
      Memory: initialStats.Memory,
      CPU: initialStats.CPU,
    },
    periodicStats,
    totalRuntime,
  };
}
