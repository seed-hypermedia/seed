import {CPUStats, MemoryStats, MetricsData, PeriodicStat} from "../types";
import {calculateCPUPercentage, formatBytes} from "../utils/formatters";

interface OverviewPanelProps {
  data: MetricsData;
}

export function OverviewPanel({data}: OverviewPanelProps) {
  const maxMemory = Math.max(
    ...data.periodicStats
      .filter(
        (stat): stat is PeriodicStat & {data: MemoryStats} =>
          stat.type === "Memory"
      )
      .map((stat) => stat.data.rss)
  );

  const lastCPUStat = data.periodicStats
    .filter(
      (stat): stat is PeriodicStat & {data: CPUStats} => stat.type === "CPU"
    )
    .pop();

  const cpuPercentage = lastCPUStat
    ? calculateCPUPercentage(
        lastCPUStat.data.user,
        lastCPUStat.data.system,
        data.totalRuntime
      )
    : 0;

  console.log(data);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-6 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
            <svg
              className="w-6 h-6 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Total Runtime
            </h3>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {(data.totalRuntime / 1000).toFixed(2)}s
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-6 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-green-50 dark:bg-green-500/10 rounded-lg">
            <svg
              className="w-6 h-6 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Peak Memory
            </h3>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {formatBytes(maxMemory)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl ring-1 ring-slate-900/5 dark:ring-slate-500/10 p-6 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-500/10 rounded-lg">
            <svg
              className="w-6 h-6 text-purple-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
              CPU Usage
            </h3>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {cpuPercentage.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
