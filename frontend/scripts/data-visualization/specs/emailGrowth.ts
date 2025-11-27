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
  <script src="https://cdn.plot.ly/plotly-2.29.1.min.js"></script>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    h1 { margin-bottom: 8px; }
    p { margin-top: 0; color: #475569; }
    #chart { width: 100%; height: 70vh; }
    .card-grid { display: grid; gap: 16px; margin-top: 32px; }
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
  <h1>${escapeHtml(ctx.title)}</h1>
  <p>Query: ${escapeHtml(ctx.queryLabel)} · Source: ssh://${escapeHtml(ctx.sshTarget)}${escapeHtml(ctx.dbPath)}</p>
  <div id="chart"></div>
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
  <script>
    const rows = ${serializeForScript(rows)};
    const growthTrace = {
      x: rows.map((row) => row.date),
      y: rows.map((row) => row.growth_percent),
      name: "Growth Rate (%)",
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#3b82f6", width: 3 },
      marker: { color: "#3b82f6", size: 6 },
      hovertemplate: "%{x}<br>Growth: %{y:.2f}%<extra></extra>"
    };
    const totalUsersTrace = {
      x: rows.map((row) => row.date),
      y: rows.map((row) => row.total_users),
      name: "Total Users",
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#10b981", width: 3 },
      marker: { color: "#10b981", size: 5 },
      yaxis: "y2",
      hovertemplate: "%{x}<br>Total: %{y:,}<extra></extra>"
    };
    const newUsersTrace = {
      x: rows.map((row) => row.date),
      y: rows.map((row) => row.new_users),
      name: "New Users (weekly)",
      type: "bar",
      marker: { color: "#8b5cf6" },
      yaxis: "y2",
      opacity: 0.45,
      hovertemplate: "%{x}<br>New: %{y:,}<extra></extra>"
    };

    const layout = {
      title: ${serializeForScript(ctx.title)},
      xaxis: { title: "Week", tickangle: -45, automargin: true },
      yaxis: { title: "Growth Rate (%)", zeroline: true, tickformat: ".2f" },
      yaxis2: {
        title: "Users",
        overlaying: "y",
        side: "right",
        tickformat: ","
      },
      legend: { orientation: "h", y: -0.2 },
      margin: { l: 64, r: 64, t: 64, b: 120 },
      template: "plotly_white",
      bargap: 0.2
    };

    Plotly.newPlot("chart", [growthTrace, totalUsersTrace, newUsersTrace], layout, { responsive: true });
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