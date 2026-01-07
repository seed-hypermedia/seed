/**
 * IndexedDB storage for draft media (images, videos, files).
 * Stores media as efficient Blob objects
 * Browser-only module - requires window.indexedDB
 */

const DB_NAME = 'seed_drafts'
const DB_VERSION = 1
const MEDIA_STORE = 'draft_media'

// Cache the DB promise to avoid multiple concurrent opens
let dbPromise: Promise<IDBDatabase> | null = null

interface DraftMediaMeta {
  name: string
  mime: string
  size: number
  createdAt: number
}

interface DraftMediaValue {
  blob: Blob
  meta: DraftMediaMeta
}

// Initialize IndexedDB database
function initDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB not available'))
  }

  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('Failed to open draft media DB:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      const db = request.result

      // Handle version change from another tab by closing this connection
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }

      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create the media store if it doesn't exist
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE)
        // Create index on createdAt for cleanup queries
        store.createIndex('createdAt', 'meta.createdAt', {unique: false})
      }
    }
  })

  return dbPromise
}

// Generate storage key for draft media
function getMediaKey(draftId: string, mediaId: string): string {
  return `draft:${draftId}:media:${mediaId}`
}

// Store a media blob for a draft
export async function putDraftMedia(
  draftId: string,
  mediaId: string,
  blob: Blob,
  meta: Omit<DraftMediaMeta, 'createdAt'>,
): Promise<void> {
  try {
    const db = await initDB()
    const key = getMediaKey(draftId, mediaId)

    const value: DraftMediaValue = {
      blob,
      meta: {
        ...meta,
        createdAt: Date.now(),
      },
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readwrite')
      const store = transaction.objectStore(MEDIA_STORE)
      const request = store.put(value, key)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        console.error('Failed to store draft media:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('putDraftMedia error:', error)
    throw error
  }
}

// Retrieve a media blob for a draft
export async function getDraftMedia(
  draftId: string,
  mediaId: string,
): Promise<DraftMediaValue | null> {
  try {
    const db = await initDB()
    const key = getMediaKey(draftId, mediaId)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readonly')
      const store = transaction.objectStore(MEDIA_STORE)
      const request = store.get(key)

      request.onsuccess = () => {
        resolve(request.result || null)
      }
      request.onerror = () => {
        console.error('Failed to get draft media:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('getDraftMedia error:', error)
    return null
  }
}

// Delete a specific media item
export async function deleteDraftMedia(
  draftId: string,
  mediaId: string,
): Promise<void> {
  try {
    const db = await initDB()
    const key = getMediaKey(draftId, mediaId)

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readwrite')
      const store = transaction.objectStore(MEDIA_STORE)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        console.error('Failed to delete draft media:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('deleteDraftMedia error:', error)
  }
}

// Delete all media for a specific draft
export async function deleteAllDraftMediaForDraft(
  draftId: string,
): Promise<void> {
  try {
    const db = await initDB()
    const prefix = `draft:${draftId}:media:`

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readwrite')
      const store = transaction.objectStore(MEDIA_STORE)

      // Wait for transaction to complete before resolving
      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        console.error(
          'Transaction error deleting draft media:',
          transaction.error,
        )
        reject(transaction.error)
      }

      transaction.onabort = () => {
        console.error('Transaction aborted deleting draft media')
        reject(new Error('Transaction aborted'))
      }

      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          const key = cursor.key as string
          if (key.startsWith(prefix)) {
            store.delete(key)
          }
          cursor.continue()
        }
      }

      request.onerror = () => {
        console.error('Cursor error deleting draft media:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('deleteAllDraftMediaForDraft error:', error)
  }
}

// Clean up old draft media entries (older than specified time)
export async function cleanupOldDraftMedia(
  olderThanMs: number = 14 * 24 * 60 * 60 * 1000, // 14 days default
): Promise<void> {
  try {
    const db = await initDB()
    const cutoffTime = Date.now() - olderThanMs

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readwrite')
      const store = transaction.objectStore(MEDIA_STORE)
      const index = store.index('createdAt')
      let deletedCount = 0

      // Wait for transaction to complete before resolving
      transaction.oncomplete = () => {
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} old draft media entries`)
        }
        resolve()
      }

      transaction.onerror = () => {
        console.error(
          'Transaction error cleaning up old draft media:',
          transaction.error,
        )
        reject(transaction.error)
      }

      transaction.onabort = () => {
        console.error('Transaction aborted cleaning up old draft media')
        reject(new Error('Transaction aborted'))
      }

      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          store.delete(cursor.primaryKey)
          deletedCount++
          cursor.continue()
        }
      }

      request.onerror = () => {
        console.error(
          'Cursor error cleaning up old draft media:',
          request.error,
        )
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('cleanupOldDraftMedia error:', error)
  }
}

/**
 * Revoke object URLs from editor blocks to prevent memory leaks
 * Should be called before publishing or discarding drafts
 */
export function revokeBlockObjectURLs(blocks: any[]): void {
  if (typeof window === 'undefined') return

  const revokeFromBlock = (block: any) => {
    // Check displaySrc in props
    if (block.props?.displaySrc && typeof block.props.displaySrc === 'string') {
      if (block.props.displaySrc.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(block.props.displaySrc)
        } catch (error) {
          // URL might already be revoked or invalid
          console.debug('Failed to revoke object URL:', error)
        }
      }
    }

    // Recursively check children
    if (block.children && Array.isArray(block.children)) {
      block.children.forEach(revokeFromBlock)
    }
  }

  blocks.forEach(revokeFromBlock)
}

/**
 * Revoke object URLs from HMBlockNode array
 * Handles the format used in draft persistence
 */
export function revokeHMBlockObjectURLs(blockNodes: any[]): void {
  if (typeof window === 'undefined') return

  const revokeFromNode = (node: any) => {
    // Check link field
    if (node.block?.link && typeof node.block.link === 'string') {
      if (node.block.link.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(node.block.link)
        } catch (error) {
          console.debug('Failed to revoke object URL:', error)
        }
      }
    }

    // Recursively check children
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(revokeFromNode)
    }
  }

  blockNodes.forEach(revokeFromNode)
}
export async function getDraftMediaIds(draftId: string): Promise<string[]> {
  try {
    const db = await initDB()
    const prefix = `draft:${draftId}:media:`

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readonly')
      const store = transaction.objectStore(MEDIA_STORE)
      const mediaIds: string[] = []

      // Use cursor to iterate and filter by prefix
      const request = store.openKeyCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result
        if (cursor) {
          const key = cursor.key as string
          if (key.startsWith(prefix)) {
            // Extract mediaId from key (remove prefix)
            const mediaId = key.substring(prefix.length)
            mediaIds.push(mediaId)
          }
          cursor.continue()
        } else {
          resolve(mediaIds)
        }
      }

      request.onerror = () => {
        console.error('Failed to get draft media IDs:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('getDraftMediaIds error:', error)
    return []
  }
}
