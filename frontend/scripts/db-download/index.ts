#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const isProd = process.argv.includes("--prod");
const REMOTE_HOST = isProd ? "hyper.media" : "dev.hyper.media";
const REMOTE_PATH = "/shm/gateway/notify/web-db.sqlite";
const LOCAL_PATH = join(import.meta.dir, "web-db.sqlite");

console.log(`Downloading database from ssh://${REMOTE_HOST}${REMOTE_PATH} ${isProd ? "(PROD)" : "(DEV)"}`);

// Remove existing local file if it exists
if (existsSync(LOCAL_PATH)) {
  console.log("Removing existing local database file...");
  unlinkSync(LOCAL_PATH);
}

// Download database via SCP
const result = spawnSync("scp", [`ubuntu@${REMOTE_HOST}:${REMOTE_PATH}`, LOCAL_PATH], {
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("Failed to download database");
  process.exit(1);
}

console.log("\nDatabase downloaded successfully!");
console.log("\nAnalyzing tables...\n");

// Open database and get table stats
const db = new Database(LOCAL_PATH, { readonly: true });

// Get all tables
const tables = db
  .query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )
  .all() as { name: string }[];

console.log("Tables and row counts:");
console.log("─".repeat(50));

let totalRows = 0;
for (const { name } of tables) {
  const result = db.query(`SELECT COUNT(*) as count FROM "${name}"`).get() as {
    count: number;
  };
  const count = result.count;
  totalRows += count;
  console.log(`${name.padEnd(35)} ${count.toLocaleString().padStart(10)}`);
}

console.log("─".repeat(50));
console.log(`${"TOTAL".padEnd(35)} ${totalRows.toLocaleString().padStart(10)}`);

// Print email subscriptions
console.log("\n\nEmail Subscriptions:");
console.log("═".repeat(80));

type Email = {
  email: string;
  isUnsubscribed: number;
};

type Subscription = {
  id: string;
  email: string;
  notifyAllMentions: number;
  notifyAllReplies: number;
  notifyOwnedDocChange: number;
  notifySiteDiscussions: number;
  notifyAllComments: number;
};

const emails = db.query(`SELECT email, isUnsubscribed FROM emails ORDER BY email`).all() as Email[];

// Collect all unique IDs
const allIds = new Set<string>();
const allSubs = db.query(`SELECT id FROM email_subscriptions`).all() as { id: string }[];
for (const { id } of allSubs) {
  allIds.add(id);
}

// Fetch titles for all IDs
console.log("\n\nFetching resource titles...");
const baseUrl = isProd ? "https://hyper.media" : "https://dev.hyper.media";
const idTitles = new Map<string, string>();

for (const id of allIds) {
  try {
    const response = await fetch(`${baseUrl}/hm/api/resource/${id}`);
    if (response.ok) {
      const data = await response.json();
      const title = data?.json?.document?.metadata?.name || "(no title)";
      idTitles.set(id, title);
      console.log(`  ${id}: ${title}`);
    } else {
      idTitles.set(id, `(error: ${response.status})`);
      console.log(`  ${id}: (error: ${response.status})`);
    }
  } catch (err) {
    idTitles.set(id, "(fetch error)");
    console.log(`  ${id}: (fetch error)`);
  }
}

// Print email subscriptions with titles
console.log("\n\nEmail Subscriptions:");
console.log("═".repeat(80));

for (const { email, isUnsubscribed } of emails) {
  console.log(`\n${email}:`);

  if (isUnsubscribed) {
    console.log("  UNSUBSCRIBED");
  } else {
    const subs = db.query(`SELECT * FROM email_subscriptions WHERE email = ?`).all(email) as Subscription[];

    if (subs.length === 0) {
      console.log("  (no subscriptions)");
    } else {
      for (const sub of subs) {
        const flags: string[] = [];
        if (sub.notifyAllMentions) flags.push("allMentions");
        if (sub.notifyAllReplies) flags.push("replies");
        if (sub.notifyOwnedDocChange) flags.push("ownedDocChange");
        if (sub.notifySiteDiscussions) flags.push("siteDiscussions");
        if (sub.notifyAllComments) flags.push("allComments");

        const title = idTitles.get(sub.id) || "(unknown)";
        const flagsStr = flags.length > 0 ? flags.join(",") : "(no notifications)";
        console.log(`  ${sub.id} [${title}]: ${flagsStr}`);
      }
    }
  }
}

db.close();
