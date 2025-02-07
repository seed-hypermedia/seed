import Database from "better-sqlite3";
import {join} from "path";

let db: Database.Database;

export async function initDatabase(): Promise<void> {
  const dbFilePath = join(
    process.env.DATA_DIR || process.cwd(),
    "web-db.sqlite"
  );
  db = new Database(dbFilePath);
  const version: number = db.pragma("user_version", {simple: true}) as number;

  if (version === 0) {
    // Initial migration.
    db.exec(`
      BEGIN;
      CREATE TABLE users (
        username TEXT UNIQUE NOT NULL,
        publicKey TEXT NOT NULL,
        credId TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  // Example second migration (commented out)
  // if (version === 1) {
  //   db.exec(`
  //     BEGIN;
  //     ALTER TABLE users ADD COLUMN email TEXT;
  //     PRAGMA user_version = 2;
  //     COMMIT;
  //   `);
  // }
}

export function createUser({
  username,
  publicKey,
  credId,
}: {
  username: string;
  publicKey: string;
  credId: string;
}): void {
  const stmt = db.prepare(
    "INSERT INTO users (username, publicKey, credId) VALUES (?, ?, ?)"
  );
  stmt.run(username, publicKey, credId);
}

export function getUser(
  username: string
): {username: string; publicKey: string} | null {
  const stmt = db.prepare(
    "SELECT username, publicKey, credId FROM users WHERE username = ?"
  );
  return stmt.get(username) || null;
}
