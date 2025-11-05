#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const isProd = process.argv.includes("--prod");
const REMOTE_HOST = isProd ? "hm" : "dev.hm";
const SOURCE_PATH = "/shm/gateway/web/web-db.sqlite";
const DEST_PATH = "/shm/gateway/notify/web-db.sqlite";
const LOCAL_PATH = join(import.meta.dir, "web-db.sqlite");

console.log(`Migrating database from ${REMOTE_HOST}:${SOURCE_PATH} to ${DEST_PATH} ${isProd ? "(PROD)" : "(DEV)"}`);

// Remove existing local file if it exists
if (existsSync(LOCAL_PATH)) {
  console.log("Removing existing local database file...");
  unlinkSync(LOCAL_PATH);
}

// Download database via SCP
console.log("\nDownloading database...");
const downloadResult = spawnSync("scp", [`${REMOTE_HOST}:${SOURCE_PATH}`, LOCAL_PATH], {
  stdio: "inherit",
});

if (downloadResult.status !== 0) {
  console.error("Failed to download database");
  process.exit(1);
}

console.log("\nDatabase downloaded successfully!");

// Open database and modify tables
console.log("Modifying database...");
const db = new Database(LOCAL_PATH);

// Clear notifier_status table
console.log("  Clearing notifier_status table...");
const countBefore = db.query(`SELECT COUNT(*) as count FROM notifier_status`).get() as { count: number };
console.log(`    Rows before: ${countBefore.count}`);

db.run(`DELETE FROM notifier_status`);

const countAfter = db.query(`SELECT COUNT(*) as count FROM notifier_status`).get() as { count: number };
console.log(`    Rows after: ${countAfter.count}`);

// Disable specific notification types in email_subscriptions
console.log("  Disabling notifyAllMentions, notifyAllReplies, notifyAllComments...");
db.run(`
  UPDATE email_subscriptions
  SET notifyAllMentions = 0,
      notifyAllReplies = 0,
      notifyAllComments = 0
`);

const updatedCount = db.query(`SELECT COUNT(*) as count FROM email_subscriptions`).get() as { count: number };
console.log(`    Updated ${updatedCount.count} subscription rows`);

db.close();

// Upload to temporary location in /shm/gateway
const TEMP_PATH = "/shm/gateway/web-db-migrate-temp.sqlite";
console.log("\nUploading to temporary location...");
const uploadResult = spawnSync("scp", [LOCAL_PATH, `${REMOTE_HOST}:${TEMP_PATH}`], {
  stdio: "inherit",
});

if (uploadResult.status !== 0) {
  console.error("Failed to upload database");
  process.exit(1);
}

// Stop notify service, move database, set permissions, and restart
console.log("\nStopping notify service...");
const stopResult = spawnSync("ssh", [REMOTE_HOST, "docker stop notify"], {
  stdio: "inherit",
});

if (stopResult.status !== 0) {
  console.error("Failed to stop notify service");
  process.exit(1);
}

console.log("Moving to final destination and setting permissions...");
const moveResult = spawnSync(
  "ssh",
  [
    REMOTE_HOST,
    `sudo mv ${TEMP_PATH} ${DEST_PATH} && sudo chown --reference=${SOURCE_PATH} ${DEST_PATH} && sudo chmod --reference=${SOURCE_PATH} ${DEST_PATH}`,
  ],
  {
    stdio: "inherit",
  }
);

if (moveResult.status !== 0) {
  console.error("Failed to move database or set permissions");
  process.exit(1);
}

console.log("Starting notify service...");
const startResult = spawnSync("ssh", [REMOTE_HOST, "docker start notify"], {
  stdio: "inherit",
});

if (startResult.status !== 0) {
  console.error("Failed to start notify service");
  process.exit(1);
}

console.log("\nMigration completed successfully!");
console.log(`Database migrated to ${REMOTE_HOST}:${DEST_PATH}`);
