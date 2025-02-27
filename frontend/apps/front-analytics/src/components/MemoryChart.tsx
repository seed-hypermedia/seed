import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {MemoryStats, PeriodicStat} from "../types";
import {formatBytes} from "../utils/formatters";

interface MemoryChartProps {
  periodicStats: PeriodicStat[];
}

export function MemoryChart({periodicStats}: MemoryChartProps) {
  const memoryData = periodicStats
    .filter(
      (stat): stat is PeriodicStat & {data: MemoryStats} =>
        stat.type === "Memory"
    )
    .map((stat) => ({
      timestamp: new Date(stat.timestamp).toLocaleTimeString(),
      rss: stat.data.rss,
      heapTotal: stat.data.heapTotal,
      heapUsed: stat.data.heapUsed,
    }));

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={memoryData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timestamp" />
          <YAxis tickFormatter={formatBytes} />
          <Tooltip
            formatter={(value: number) => formatBytes(value)}
            labelFormatter={(label) => `Time: ${label}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="rss"
            stroke="#8884d8"
            name="RSS Memory"
          />
          <Line
            type="monotone"
            dataKey="heapTotal"
            stroke="#82ca9d"
            name="Heap Total"
          />
          <Line
            type="monotone"
            dataKey="heapUsed"
            stroke="#ffc658"
            name="Heap Used"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
