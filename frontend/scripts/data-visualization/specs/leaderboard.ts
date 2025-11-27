import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import type { AnalyticsContext, AnalyticsSpec } from "./types";

export interface LeaderboardRow {
  id: string;
  subscriber_count: number;
  subscriber_pct_numeric: number | null;
  subscriber_pct_label: string | null;
  title?: string | null;
}

const sqlPath = fileURLToPath(new URL("../email-leaderboard.sql", import.meta.url));
const sqlDisplayName = "frontend/scripts/data-visualization/email-leaderboard.sql";
const numberFormatter = new Intl.NumberFormat("en-US");

export const leaderboardSpec: AnalyticsSpec<LeaderboardRow> = {
  flag: "leaderboard",
  description: "Top subscribed resources leaderboard",
  sqlPath,
  sqlDisplayName,
  defaultTitle: "Subscription Leaderboard",
  transform(rows) {
    return rows.map((row) => ({
      id: String(row.id),
      subscriber_count: Number(row.subscriber_count ?? 0),
      subscriber_pct_numeric:
        row.subscriber_pct_numeric === null || row.subscriber_pct_numeric === undefined
          ? null
          : Number(row.subscriber_pct_numeric),
      subscriber_pct_label:
        row.subscriber_pct_label === null || row.subscriber_pct_label === undefined
          ? null
          : String(row.subscriber_pct_label),
      title: null
    }));
  },
  buildJson(rows, ctx) {
    ensureTitles(rows, ctx);
    return {
      rows,
      meta: buildMeta(ctx, "leaderboard"),
      summary: computeSummary(rows)
    };
  },
  buildHtml(rows, ctx) {
    ensureTitles(rows, ctx);
    const summary = computeSummary(rows);
    const totalSubscribers = summary.totalSubscribers ?? 0;
    const totalDisplay = numberFormatter.format(totalSubscribers);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ctx.title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f1f5f9; min-height: 100vh; display: flex; flex-direction: column; gap: 24px; }
    header h1 { margin: 0 0 8px; font-size: 32px; }
    header p { margin: 0; color: #94a3b8; }
    main { flex: 1; display: flex; flex-direction: column; gap: 24px; }
    #treemap-container { flex: 1; position: relative; min-height: 360px; }
    #treemap { width: 100%; height: 100%; border-radius: 16px; overflow: hidden; background: rgba(15, 23, 42, 0.4); }
    .tooltip { position: absolute; pointer-events: none; background: rgba(15, 23, 42, 0.92); color: #f8fafc; padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.4; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.35); opacity: 0; transition: opacity 120ms ease; border: 1px solid rgba(148, 163, 184, 0.35); }
    .legend { display: flex; gap: 16px; flex-wrap: wrap; color: #cbd5f5; font-size: 14px; }
    .legend > div { display: flex; gap: 6px; align-items: center; }
    .legend span { display: inline-block; width: 14px; height: 14px; border-radius: 3px; }
    footer { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    footer .card { background: rgba(15, 23, 42, 0.55); padding: 18px; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.35); }
    footer .card-title { text-transform: uppercase; letter-spacing: 0.1em; font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
    footer .card-value { font-size: 26px; font-weight: 600; margin: 0; color: #f8fafc; }
    footer .card-subtitle { font-size: 13px; color: #cbd5f5; margin-top: 4px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(ctx.title)}</h1>
      <p>Query: ${escapeHtml(ctx.queryLabel)} · Source: ssh://${escapeHtml(ctx.sshTarget)}${escapeHtml(ctx.dbPath)}</p>
    </header>

    <section id="treemap-container">
      <svg id="treemap"></svg>
      <div class="tooltip" id="tooltip"></div>
    </section>

    <div class="legend">
      <div><span style="background: #1d4ed8;"></span> Highest share of subscribers</div>
      <div><span style="background: #38bdf8;"></span> Moderate share</div>
      <div><span style="background: #22d3ee;"></span> Lower share</div>
    </div>

    <footer>
      <div class="card">
        <p class="card-title">Total Subscribers (Top 10)</p>
        <p class="card-value">${escapeHtml(totalDisplay)}</p>
        <p class="card-subtitle">Combined across displayed resources</p>
      </div>
      <div class="card">
        <p class="card-title">Top Resource</p>
        <p class="card-value">${escapeHtml(summary.topTitle ?? summary.topId ?? "—")}</p>
        <p class="card-subtitle">${escapeHtml(summary.topPctLabel ?? "—")} · ${escapeHtml(formatNumber(summary.topCount ?? 0))} subscribers</p>
      </div>
    </footer>
  </main>

  <script>
    const rows = ${serializeForScript(rows)};
    const numberFormatter = new Intl.NumberFormat("en-US");

    const container = document.getElementById("treemap");
    const tooltip = document.getElementById("tooltip");

    function renderTreemap() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      container.setAttribute("viewBox", \`0 0 \${width} \${height}\`);
      container.innerHTML = "";

      const data = {
        name: "subscriptions",
        children: rows.map((row) => ({
          id: row.id,
          label: row.title ?? row.id,
          value: row.subscriber_count,
          pctValue: row.subscriber_pct_numeric ?? 0,
          pctLabel: row.subscriber_pct_label ?? "—"
        }))
      };

      const root = d3.hierarchy(data).sum((d) => d.value);
      d3.treemap().paddingInner(3).size([width, height])(root);

      const extent = d3.extent(root.leaves(), (d) => d.data.pctValue);
      const color = d3.scaleSequential().domain(extent).interpolator(d3.interpolateTurbo);

      const nodes = d3.select(container)
        .selectAll("g")
        .data(root.leaves())
        .enter()
        .append("g")
        .attr("transform", (d) => \`translate(\${d.x0},\${d.y0})\`);

      nodes.append("rect")
        .attr("width", (d) => d.x1 - d.x0)
        .attr("height", (d) => d.y1 - d.y0)
        .attr("rx", 8)
        .attr("ry", 8)
        .attr("fill", (d) => color(d.data.pctValue))
        .attr("fill-opacity", 0.9)
        .attr("stroke", "rgba(15, 23, 42, 0.35)")
        .attr("stroke-width", 1.2)
        .on("mousemove", (event, d) => {
          tooltip.style.opacity = "1";
          tooltip.style.left = \`\${event.offsetX + 16}px\`;
          tooltip.style.top = \`\${event.offsetY + 16}px\`;
          tooltip.innerHTML = \`
            <strong>\${d.data.label}</strong><br/>
            Subscribers: \${numberFormatter.format(d.data.value)}<br/>
            Share: \${d.data.pctLabel}
          \`;
        })
        .on("mouseleave", () => {
          tooltip.style.opacity = "0";
        });

      nodes.append("text")
        .attr("x", 12)
        .attr("y", 24)
        .attr("fill", "#0f172a")
        .attr("font-size", "14")
        .attr("font-weight", "600")
        .text((d) => d.data.label)
        .call(wrapText, (d) => d.x1 - d.x0 - 24);

      nodes.append("text")
        .attr("x", 12)
        .attr("y", 44)
        .attr("fill", "rgba(15, 23, 42, 0.75)")
        .attr("font-size", "13")
        .text((d) => \`\${numberFormatter.format(d.data.value)} · \${d.data.pctLabel}\`);
    }

    function wrapText(text, widthAccessor) {
      text.each(function(d) {
        const width = widthAccessor(d);
        const textEl = d3.select(this);
        const words = textEl.text().split(/\\s+/).reverse();
        let word;
        let line = [];
        let lineNumber = 0;
        const lineHeight = 16;
        const x = textEl.attr("x");
        const y = textEl.attr("y");
        const dy = 0;
        let tspan = textEl.text(null).append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "px");
        while ((word = words.pop())) {
          line.push(word);
          tspan.text(line.join(" "));
          if (tspan.node().getComputedTextLength() > width && line.length > 1) {
            line.pop();
            tspan.text(line.join(" "));
            line = [word];
            tspan = textEl.append("tspan").attr("x", x).attr("y", y).attr("dy", ++lineNumber * lineHeight + "px").text(word);
          }
        }
      });
    }

    renderTreemap();
    window.addEventListener("resize", renderTreemap);
  </script>
</body>
</html>`;
  },
  buildEmptyJson(ctx) {
    return {
      rows: [],
      meta: buildMeta(ctx, "leaderboard"),
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
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #f8fafc; }
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

function computeSummary(rows: LeaderboardRow[]) {
  const totalSubscribers = rows.reduce((sum, row) => sum + row.subscriber_count, 0);
  const top = rows[0];
  return {
    totalSubscribers,
    topId: top?.id ?? null,
    topTitle: top?.title ?? null,
    topCount: top?.subscriber_count ?? null,
    topPctLabel: top?.subscriber_pct_label ?? null
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

function ensureTitles(rows: LeaderboardRow[], ctx: AnalyticsContext) {
  const missingIds = Array.from(
    new Set(
      rows
        .filter((row) => !row.title || row.title === row.id)
        .map((row) => row.id)
    )
  );
  if (missingIds.length === 0) {
    return;
  }

  console.log(`Fetching ${missingIds.length} resource titles via HTTP...`);
  const titles = fetchTitlesViaCurl(missingIds, ctx);

  for (const row of rows) {
    const title = titles.get(row.id);
    if (title && title.trim().length > 0) {
      row.title = title;
    } else if (!row.title) {
      row.title = row.id;
    }
  }
}

function fetchTitlesViaCurl(ids: string[], ctx: AnalyticsContext) {
  const map = new Map<string, string>();
  if (ids.length === 0) {
    return map;
  }

  const baseUrl = resolveBaseUrl(ctx);
  const total = ids.length;

  ids.forEach((id, index) => {
    const label = `[${index + 1}/${total}]`;
    console.log(`${label} ${id}`);
    const url = `${baseUrl}/hm/api/resource/${encodeURIComponent(id)}`;
    const result = spawnSync("curl", ["-sS", "-L", "--max-time", "6", url], {
      encoding: "utf8"
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    if (result.status !== 0) {
      console.log(`${label} ${id} → (curl error, exit ${result.status}${stderr ? `, stderr: ${stderr.trim()}` : ""})`);
      return;
    }

    try {
      const payload = JSON.parse(result.stdout);
      const title = extractTitle(payload);
      if (title) {
        console.log(`${label} ${id} → ${title}`);
        map.set(id, title);
      } else {
        console.log(`${label} ${id} → (no title)`);
      }
    } catch {
      const preview = stdout.slice(0, 160).replace(/\s+/g, " ").trim();
      console.log(`${label} ${id} → (parse error, body preview: ${preview || "[empty]"})`);
    }
  });

  return map;
}

function resolveBaseUrl(ctx: AnalyticsContext) {
  const { sshTarget } = ctx;

  // Accept forms like "ubuntu@dev.hyper.media:22" or "dev.hyper.media:8080"
  const m = sshTarget.match(/^(?:[^@]+@)?([^:]+)(?::(\d+))?$/);
  const host = m ? m[1] : sshTarget;
  const port = m && m[2] ? `:${m[2]}` : "";

  // Use HTTPS root so URLs match the ones used by scripts like db-download/index.ts
  return `https://${host}${port}`;
}

function extractTitle(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const json = (payload as Record<string, unknown>).json;
  if (json && typeof json === "object") {
    const document = (json as Record<string, unknown>).document;
    if (document && typeof document === "object") {
      const metadata = (document as Record<string, unknown>).metadata;
      if (metadata && typeof metadata === "object") {
        const name = (metadata as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim().length > 0) {
          return name;
        }
        const title = (metadata as Record<string, unknown>).title;
        if (typeof title === "string" && title.trim().length > 0) {
          return title;
        }
      }
    }
  }
  const title = (payload as Record<string, unknown>).title;
  return typeof title === "string" && title.trim().length > 0 ? title : undefined;
}