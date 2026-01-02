// Set up test environment mocks
const TEST_ORIGIN = "http://localhost:3000";

// Mock the window object
global.window = {
  ...global.window,
  location: {
    origin: TEST_ORIGIN,
  },
} as any;

// Mock the origin variable that local-db.ts uses
(global as any).origin = TEST_ORIGIN;

import { indexedDB } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasPromptedEmailNotifications,
  resetDB,
  setHasPromptedEmailNotifications,
} from "./local-db";

const DB_NAME = "keyStore-04";

describe("local-db integration", () => {
  beforeEach(async () => {
    // Delete any existing database
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve(); // Continue even if error
    });
  });

  afterEach(async () => {
    // Clean up the database
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve(); // Continue even if error
    });
  });

  it("should initialize the database with correct version and stores", async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB);

    try {
      expect(db.version).toBe(5);

      // Verify all stores exist
      const storeNames = Array.from(db.objectStoreNames);
      expect(storeNames).toContain("keys-01");
      expect(storeNames).toContain("email-notifications-01");
    } finally {
      // Always close the database connection
      db.close();
    }
  });

  it("should handle hasPromptedEmailNotifications and setHasPromptedEmailNotifications", async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB);

    try {
      // Test hasPromptedEmailNotifications when not set
      const hasPrompted = await hasPromptedEmailNotifications();
      expect(hasPrompted).toBe(false);

      // Test setHasPromptedEmailNotifications
      await setHasPromptedEmailNotifications(true);

      // Test hasPromptedEmailNotifications after setting
      const hasPromptedAfter = await hasPromptedEmailNotifications();
      expect(hasPromptedAfter).toBe(true);

      // Test setting back to false
      await setHasPromptedEmailNotifications(false);
      const hasPromptedFalse = await hasPromptedEmailNotifications();
      expect(hasPromptedFalse).toBe(false);
    } finally {
      // Always close the database connection
      db.close();
    }
  });
});
