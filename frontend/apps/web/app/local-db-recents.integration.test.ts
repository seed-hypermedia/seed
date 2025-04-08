// Set up test environment mocks
const TEST_ORIGIN = 'http://localhost:3000'

// Mock the window object
global.window = {
  ...global.window,
  location: {
    origin: TEST_ORIGIN,
  },
} as any

// Mock the origin variable that local-db.ts uses
;(global as any).origin = TEST_ORIGIN

import {RecentsResult} from '@shm/shared/models/recents'
import {indexedDB} from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  addRecent,
  clearRecents,
  deleteRecent,
  getRecents,
  resetDB,
} from './local-db-recents'

const DB_NAME = 'recents-db-01'

// Helper function to create hypermedia URLs
function createHmUrl(uid: string) {
  return `hm://${uid}`
}

describe('local-db-recents integration', () => {
  beforeEach(async () => {
    // Delete any existing database
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => resolve() // Continue even if error
    })

    // Initialize a fresh database for each test
    await resetDB(indexedDB)
  })

  afterEach(async () => {
    // Clean up the database
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
      deleteRequest.onsuccess = () => resolve()
      deleteRequest.onerror = () => resolve() // Continue even if error
    })
  })

  it('should initialize the database with correct version and stores', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      expect(db.version).toBe(1)

      // Verify the recents store exists
      const storeNames = Array.from(db.objectStoreNames)
      expect(storeNames).toContain('recents-01')

      // Verify the time index exists
      const store = db.transaction('recents-01').objectStore('recents-01')
      expect(store.indexNames.contains('time')).toBe(true)
    } finally {
      // Always close the database connection
      db.close()
    }
  })

  it('should add and retrieve recent items', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      // Add a recent item
      const id1 = createHmUrl('id-1')
      const recent1 = await addRecent(id1, 'Test Recent 1')
      expect(recent1.id.id).toBe(id1)
      expect(recent1.time).toBeDefined()
      expect(recent1.name).toBe('Test Recent 1')

      // Add another recent item
      const id2 = createHmUrl('id-2')
      const recent2 = await addRecent(id2, 'Test Recent 2')

      // Get all recents
      const recents = await getRecents()

      // Verify we have 2 recents
      expect(recents.length).toBe(2)

      // Verify they are sorted by time (newest first)
      expect(recents[0].id.id).toBe(id2)
      expect(recents[1].id.id).toBe(id1)
    } finally {
      // Always close the database connection
      db.close()
    }
  })

  it('should update existing items when adding with the same ID', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      // Add a recent item with a specific ID
      const id = createHmUrl('test-id-123')
      const recent1 = await addRecent(id, 'Test Recent 1')
      expect(recent1.id.id).toBe(id)
      expect(recent1.name).toBe('Test Recent 1')

      // Add a small delay to ensure different times
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Add another recent item with a different ID
      const id2 = createHmUrl('id-2')
      const recent2 = await addRecent(id2, 'Test Recent 2')

      // Add a small delay to ensure different times
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Get all recents
      let recents = await getRecents()

      // Verify we have 2 recents
      expect(recents.length).toBe(2)

      // Update the first item with the same ID
      const updatedTitle = 'Updated Test Recent 1'
      const updatedRecent = await addRecent(id, updatedTitle)
      expect(updatedRecent.id.id).toBe(id)
      expect(updatedRecent.name).toBe(updatedTitle)

      // Get all recents again
      recents = await getRecents()

      // Verify we still have 2 recents (not 3)
      expect(recents.length).toBe(2)

      // Verify the updated item is now the most recent
      expect(recents[0].id.id).toBe(id)
      expect(recents[0].name).toBe(updatedTitle)
      expect(recents[1].id.id).toBe(id2)
    } finally {
      // Always close the database connection
      db.close()
    }
  })

  it('should limit the number of recents to MAX_RECENTS', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      // Add more than MAX_RECENTS items
      const recentsToAdd = 25 // More than the MAX_RECENTS (20)
      const addedRecents: RecentsResult[] = []

      // Add items with a small delay between each to avoid race conditions
      for (let i = 0; i < recentsToAdd; i++) {
        const id = createHmUrl(`id-${i}`)
        const recent = await addRecent(id, `Test Recent ${i}`)
        addedRecents.push(recent)
        // Add a small delay between operations
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      // Get all recents
      const recents = await getRecents()

      // Verify we have exactly MAX_RECENTS items
      expect(recents.length).toBe(20)

      // Verify the oldest items were removed
      // The first 5 items should not be in the recents list
      for (let i = 0; i < 5; i++) {
        expect(recents.some((r) => r.id.id === addedRecents[i].id.id)).toBe(
          false,
        )
      }

      // The last 20 items should be in the recents list
      for (let i = 5; i < recentsToAdd; i++) {
        expect(recents.some((r) => r.id.id === addedRecents[i].id.id)).toBe(
          true,
        )
      }
    } finally {
      // Always close the database connection
      db.close()
    }
  })

  it('should delete a specific recent item', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      // Add a recent item
      const id = createHmUrl('id-1')
      const recent = await addRecent(id, 'Test Recent')

      // Delete the recent item
      await deleteRecent(id)

      // Get all recents
      const recents = await getRecents()

      // Verify the recent item was deleted
      expect(recents.length).toBe(0)
    } finally {
      // Always close the database connection
      db.close()
    }
  })

  it('should clear all recent items', async () => {
    // Initialize a fresh database
    const db = await resetDB(indexedDB)

    try {
      // Add multiple recent items
      await addRecent(createHmUrl('id-1'), 'Test Recent 1')
      await addRecent(createHmUrl('id-2'), 'Test Recent 2')
      await addRecent(createHmUrl('id-3'), 'Test Recent 3')

      // Clear all recents
      await clearRecents()

      // Get all recents
      const recents = await getRecents()

      // Verify all recents were cleared
      expect(recents.length).toBe(0)
    } finally {
      // Always close the database connection
      db.close()
    }
  })
})
