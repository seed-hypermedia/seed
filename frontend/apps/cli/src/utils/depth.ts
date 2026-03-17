/**
 * Re-exports document state resolution from the client SDK.
 *
 * The implementation now lives in @seed-hypermedia/client so it can be shared
 * across the CLI, desktop app, and other consumers.
 */

export {resolveDocumentState} from '@seed-hypermedia/client'
export type {DocumentState} from '@seed-hypermedia/client'
