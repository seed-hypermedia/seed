import { fileURLToPath } from "url";
import type { AnalyticsContext, AnalyticsSpec } from "./types";

export interface EmailGrowthRow {
  date: string;
  new_users: number;
  total_users: number;
  growth_percent: number | null;
  growth_label: string | null;
}

const sqlPath = fileURLToPath(new URL("../email-growth.sql", import.meta.url));
const sqlDisplayName = "frontend/scripts/data-visualization/email-growth.sql";
const numberFormatter = new Intl.NumberFormat("en-US");

export const emailGrowthSpec: AnalyticsSpec<EmailGrowthRow> = {
  flag: "growth",
  description: "Email subscriber growth (weekly, trailing year)",
  sqlPath,
  sqlDisplayName,
  defaultTitle: "Email Growth Analytics",
  transform(rows) {
    return rows.map((row) => ({
      date: String(row.date),
      new_users: Number(row.new_users ?? 0),
      total_users: Number(row.total_users ?? 0),
      growth_percent:
        row.growth_percent === null || row.growth_percent === undefined
          ? null
          : Number(row.growth_percent),
      growth_label:
        row.growth_label === null || row.growth_label === undefined
          ? null
          : String(row.growth_label)
    }));
  },
  filterRows(rows, ctx) {
    if (!ctx.fromDate) {
      return rows;
    }
    return rows.filter((row) => row.date >= ctx.fromDate!);
  },
  buildJson(rows, ctx) {
    return {
      rows,
      meta: buildMeta(ctx, "growth"),
      summary: computeSummary(rows)
    };
  },
  buildHtml(rows, ctx) {
    const summary = computeSummary(rows);
    const peakGrowthDisplay = summary.peakGrowthPercent !== null
      ? formatPercent(summary.peakGrowthPercent)
      : "—";
    const peakGrowthDate = summary.peakGrowthDate ?? "—";
    const totalUsersDisplay = summary.latestTotalUsers !== null
      ? formatNumber(summary.latestTotalUsers)
      : "—";
    const totalUsersDate = summary.latestDate ?? "—";
    const averageGrowthDisplay = summary.averageGrowthPercent !== null
      ? formatPercent(summary.averageGrowthPercent)
      : "—";
    const weeksCount = summary.weekCount;
    const weeksLabel = weeksCount === 1 ? "week" : "weeks";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ctx.title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; flex-direction: column; gap: 24px; }
    main { flex: 1; display: flex; flex-direction: column; gap: 24px; }
    header h1 { margin: 0 0 8px; }
    header p { margin: 0; color: #475569; }
    #chart-wrapper { position: relative; flex: 1; min-height: 320px; height: clamp(320px, 70vh, calc(100vh - 320px)); }
    .card-grid { display: grid; gap: 16px; }
    @media (min-width: 768px) { .card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .card { border-radius: 12px; padding: 16px; border: 1px solid rgba(148, 163, 184, 0.3); background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    .card--blue { background: #eff6ff; border-color: #bfdbfe; }
    .card--green { background: #ecfdf5; border-color: #bbf7d0; }
    .card--purple { background: #f3e8ff; border-color: #e9d5ff; }
    .card-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
    .card-value { font-size: 28px; font-weight: 700; margin: 0; }
    .card-subtitle { font-size: 12px; margin-top: 6px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(ctx.title)}</h1>
      <p>Query: ${escapeHtml(ctx.queryLabel)} · Source: ssh://${escapeHtml(ctx.sshTarget)}${escapeHtml(ctx.dbPath)}</p>
    </header>
    <div id="chart-wrapper">
      <canvas id="growthChart"></canvas>
    </div>
    <div class="card-grid">
      <div class="card card--blue">
        <p class="card-title">Peak Growth Rate</p>
        <p class="card-value">${escapeHtml(peakGrowthDisplay)}</p>
        <p class="card-subtitle">${escapeHtml(peakGrowthDate)}</p>
      </div>
      <div class="card card--green">
        <p class="card-title">Total Users</p>
        <p class="card-value">${escapeHtml(totalUsersDisplay)}</p>
        <p class="card-subtitle">As of ${escapeHtml(totalUsersDate)}</p>
      </div>
      <div class="card card--purple">
        <p class="card-title">Average Growth</p>
        <p class="card-value">${escapeHtml(averageGrowthDisplay)}</p>
        <p class="card-subtitle">Over ${escapeHtml(String(weeksCount))} ${escapeHtml(weeksLabel)}</p>
      </div>
    </div>
  </main>
  <script>
    const rows = ${serializeForScript(rows)};
    const ctxEl = document.getElementById("growthChart");
    const growthData = rows.map((row) => row.growth_percent);
    const totalData = rows.map((row) => row.total_users);
    const newUsersData = rows.map((row) => row.new_users);
    const labels = rows.map((row) => row.date);
    const numberFormatter = new Intl.NumberFormat("en-US");

    const crosshairPlugin = {
      id: "verticalCrosshair",
      afterDraw(chart) {
        const active = chart.tooltip?.getActiveElements?.();
        if (!active || active.length === 0) {
          return;
        }
        const { ctx, scales } = chart;
        const x = active[0].element.x;
        const topY = Math.min(scales.growthAxis.top, scales.userAxis.top);
        const bottomY = Math.max(scales.growthAxis.bottom, scales.userAxis.bottom);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
      }
    };

    Chart.register(crosshairPlugin);

    new Chart(ctxEl, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            type: "line",
            label: "Growth Rate (%)",
            data: growthData,
            yAxisID: "growthAxis",
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.18)",
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: "#3b82f6",
            tension: 0.3
          },
          {
            type: "line",
            label: "Total Users",
            data: totalData,
            yAxisID: "userAxis",
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.18)",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#10b981",
            tension: 0.3
          },
          {
            type: "bar",
            label: "New Users (weekly)",
            data: newUsersData,
            yAxisID: "userAxis",
            backgroundColor: "rgba(139, 92, 246, 0.45)",
            borderRadius: 4,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", axis: "x", intersect: false },
        scales: {
          growthAxis: {
            type: "linear",
            position: "left",
            title: { text: "Growth Rate (%)", display: true, color: "#3b82f6" },
            ticks: {
              color: "#3b82f6",
              callback: (value) => \`\${Number(value).toFixed(0)}%\`
            }
          },
          userAxis: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            title: { text: "Users", display: true, color: "#10b981" },
            ticks: {
              color: "#10b981",
              callback: (value) => numberFormatter.format(Number(value))
            }
          },
          x: {
            ticks: { maxRotation: 45, minRotation: 45 },
            title: { text: "Week", display: true }
          }
        },
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: {
            callbacks: {
              label(context) {
                const { dataset, raw } = context;
                if (raw === null || raw === undefined || Number.isNaN(raw)) {
                  return \`\${dataset.label}: —\`;
                }
                if (dataset.yAxisID === "growthAxis") {
                  return \`\${dataset.label}: \${Number(raw).toFixed(2)}%\`;
                }
                return \`\${dataset.label}: \${numberFormatter.format(Number(raw))}\`;
              },
              title(context) {
                return context[0]?.label ?? "";
              }
            }
          },
          title: { display: false }
        }
      }
    });
  </script>
</body>
</html>`;
  },
  buildEmptyJson(ctx) {
    return {
      rows: [],
      meta: buildMeta(ctx, "growth"),
      message: "No rows returned."
    };
  },
  buildEmptyHtml(ctx) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ctx.title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
  </style>
</head>
<body>
  <h1>${escapeHtml(ctx.title)}</h1>
  <p>Query: ${escapeHtml(ctx.queryLabel)}</p>
  <p>No rows returned.</p>
</body>
</html>`;
  }
};

function computeSummary(rows: EmailGrowthRow[]) {
  let peak: EmailGrowthRow | undefined;
  let sum = 0;
  let count = 0;

  for (const row of rows) {
    if (row.growth_percent !== null && !Number.isNaN(row.growth_percent)) {
      sum += row.growth_percent;
      count += 1;
      if (!peak || (peak.growth_percent ?? -Infinity) < row.growth_percent) {
        peak = row;
      }
    }
  }

  const last = rows[rows.length - 1];

  return {
    peakGrowthPercent: peak?.growth_percent ?? null,
    peakGrowthDate: peak?.date ?? null,
    averageGrowthPercent: count > 0 ? sum / count : null,
    latestTotalUsers: last ? last.total_users : null,
    latestDate: last ? last.date : null,
    weekCount: rows.length
  };
}

function buildMeta(ctx: AnalyticsContext, key: string) {
  return {
    key,
    title: ctx.title,
    queryFile: ctx.queryLabel,
    sshTarget: ctx.sshTarget,
    dbPath: ctx.dbPath,
    fromDate: ctx.fromDate ?? null,
    generatedAt: new Date().toISOString()
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003C");
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}