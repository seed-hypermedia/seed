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
import {CPUStats, PeriodicStat} from "../types";
import {formatCPUUsage} from "../utils/formatters";

interface CPUChartProps {
  periodicStats: PeriodicStat[];
}

export function CPUChart({periodicStats}: CPUChartProps) {
  const cpuData = periodicStats
    .filter(
      (stat): stat is PeriodicStat & {data: CPUStats} => stat.type === "CPU"
    )
    .map((stat) => ({
      timestamp: new Date(stat.timestamp).toLocaleTimeString(),
      user: stat.data.user,
      system: stat.data.system,
      total: stat.data.user + stat.data.system,
    }));

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={cpuData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="timestamp" />
          <YAxis tickFormatter={formatCPUUsage} />
          <Tooltip
            formatter={(value: number) => formatCPUUsage(value)}
            labelFormatter={(label) => `Time: ${label}`}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="user"
            stroke="#8884d8"
            name="User CPU"
          />
          <Line
            type="monotone"
            dataKey="system"
            stroke="#82ca9d"
            name="System CPU"
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="#ffc658"
            name="Total CPU"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
