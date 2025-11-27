#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { emailGrowthSpec } from "./specs/emailGrowth";
import { leaderboardSpec } from "./specs/leaderboard";
import type { AnalyticsContext, AnalyticsSpec } from "./specs/types";

const analyticsSpecs: AnalyticsSpec[] = [emailGrowthSpec, leaderboardSpec];

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}
const isDev = args.includes("--dev");

const selectedSpecs = analyticsSpecs.filter((spec) => args.includes(`--${spec.flag}`));
if (selectedSpecs.length === 0) {
  console.error("Please select one analytics flag, e.g. --growth or --leaderboard.");
  printUsage();
  process.exit(1);
}
if (selectedSpecs.length > 1) {
  console.error("Select only one analytics flag at a time.");
  process.exit(1);
}
const selectedSpec = selectedSpecs[0]!;

const REMOTE_PATH = getArgValue("--db") ?? "/shm/gateway/notify/web-db.sqlite";
const sshTarget = getArgValue("--ssh") ?? (isDev ? "ubuntu@dev.hyper.media" : "ubuntu@hyper.media");
const fromDate = getArgValue("--from");
if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
  console.error("Invalid --from value. Use YYYY-MM-DD.");
  process.exit(1);
}

const outputHtml = resolve(process.cwd(), getArgValue("--output") ?? "query-chart.html");
const outputJson = resolve(process.cwd(), getArgValue("--json") ?? "query-data.json");
const title = getArgValue("--title") ?? selectedSpec.defaultTitle;

const ctx: AnalyticsContext = {
  title,
  queryFile: selectedSpec.sqlPath,
  queryLabel: selectedSpec.sqlDisplayName,
  sshTarget,
  dbPath: REMOTE_PATH,
  fromDate
};

let querySql: string;
try {
  querySql = readFileSync(selectedSpec.sqlPath, "utf8").trim();
} catch (err) {
  console.error(`Failed to read query file: ${selectedSpec.sqlDisplayName}`);
  process.exit(1);
}

if (querySql.length === 0) {
  console.error("Selected query file is empty.");
  process.exit(1);
}

console.log(
  `Running --${selectedSpec.flag} against ssh://${sshTarget}${REMOTE_PATH} ${isDev ? "(DEV)" : "(PROD)"}`
);

try {
  const rawRows = runRemoteQuery(querySql);
  let rows = selectedSpec.transform(rawRows);
  if (selectedSpec.filterRows) {
    rows = selectedSpec.filterRows(rows, ctx);
  }

  if (rows.length === 0) {
    const emptyJson = selectedSpec.buildEmptyJson
      ? selectedSpec.buildEmptyJson(ctx)
      : defaultEmptyJson(ctx, selectedSpec.flag, "No rows returned.");
    const emptyHtml = selectedSpec.buildEmptyHtml
      ? selectedSpec.buildEmptyHtml(ctx)
      : defaultEmptyHtml(ctx, "No rows returned.");
    writeFileSync(outputJson, JSON.stringify(emptyJson, null, 2));
    writeFileSync(outputHtml, emptyHtml);
    console.log(`Empty artifacts written to ${outputHtml} and ${outputJson}`);
    process.exit(0);
  }

  const jsonPayload = selectedSpec.buildJson(rows, ctx);
  const htmlPayload = selectedSpec.buildHtml(rows, ctx);

  writeFileSync(outputJson, JSON.stringify(jsonPayload, null, 2));
  writeFileSync(outputHtml, htmlPayload);

  console.log(`Chart written to ${outputHtml}`);
  console.log(`Data written to ${outputJson}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Query execution failed: ${message}`);
  if (message.toLowerCase().includes("permission denied")) {
    console.error(`Hint: ensure your SSH key can access ${sshTarget}.`);
  }
  process.exit(1);
}

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`);
    process.exit(1);
  }
  return value;
}

function runRemoteQuery(sql: string) {
  const sshArgs = [sshTarget, "sqlite3", "-json", REMOTE_PATH];
  const result = spawnSync("ssh", sshArgs, {
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.error) {
    throw new Error(`Failed to execute ssh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(stderr || `ssh exited with ${result.status}`);
  }
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return [];
  }
  return JSON.parse(trimmed) as Record<string, unknown>[];
}

function defaultEmptyJson(ctx: AnalyticsContext, key: string, message: string) {
  return {
    rows: [],
    meta: defaultMeta(ctx, key),
    message
  };
}

function defaultEmptyHtml(ctx: AnalyticsContext, message: string) {
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
  <p>Query file: ${escapeHtml(ctx.queryLabel)}</p>
  <p>${escapeHtml(message)}</p>
</body>
</html>`;
}

function defaultMeta(ctx: AnalyticsContext, key: string) {
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

function printUsage() {
  const analyticsLines = analyticsSpecs
    .map((spec) => `  ${`--${spec.flag}`.padEnd(16)}${spec.description}`)
    .join("\n");

  console.log(`Usage: bun frontend/scripts/data-visualization/index.ts [analytics flag] [options]

Analytics:
${analyticsLines}

Options:
  --dev              Use development host overrides
  --ssh <user@host>  Override SSH target (default: ubuntu@hyper.media; --dev switches to ubuntu@dev.hyper.media)
  --db <path>        Remote sqlite file path (default: /shm/gateway/notify/web-db.sqlite)
  --from <YYYY-MM-DD> Filter results to rows on/after this date
  --output <file>    HTML output path (default: query-chart.html)
  --json <file>      JSON output path (default: query-data.json)
  --title <text>     Chart title override`);
}