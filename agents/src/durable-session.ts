/**
 * Pi Durable storage for agent sessions.
 *
 * Every Seed session owns one Pi Durable Session, stored in the agents database beside the
 * session's log (`session_durable_files`). Its root conversation is the model-facing transcript of
 * the session: exact provider messages (thinking blocks, reasoning items, usage), the positional
 * system prompt, and the checkpoints of the turn in flight. A process that dies mid-turn leaves
 * that work pending in the store, and the run that retries it reopens the store and continues
 * from the last checkpoint.
 *
 * The store is Pi Durable's own append-only JSONL format, unchanged. Only where its files live is
 * Seed's: {@link sessionFileSystem} keeps each file as rows of one table, an append being one
 * inserted row. So a session's state is in one database, backed up and deleted with it, and Seed
 * maintains no storage engine of its own.
 *
 * The Seed log (`session_events`) stays the canonical record of what happened. The two are kept in
 * step from both sides:
 *
 * - Everything the harness produces is projected into the log, one durable entry at a time, and
 *   the event rows carry the entry id (`session_events.pi_entry_id`), so a projection interrupted
 *   by a crash is finished on the next open and never repeated.
 * - Everything else that reaches the log (user messages, user-run verbs, system notices, results
 *   of delegated work) is imported into the conversation before the next turn. The import mark
 *   lives in the {@link SyncDoc} document, committed together with the imported entries.
 *
 * A result that arrives long after its call (a delegated child finishing) is written as a context
 * edit of the placeholder the call was answered with. When the log holds something that cannot be
 * added to the conversation as it stands (a session that predates this store, a call the runtime
 * had to answer after a restart), the conversation's context is rebuilt from the log behind a
 * fresh head; the earlier entries stay in storage.
 *
 * One harness owns a store at a time. Only the run that holds the session's turn opens it.
 */

import type {Database} from 'bun:sqlite'
import * as chordContext from '@earendil-works/chord/context'
import type * as piAi from '@earendil-works/pi-ai'
import * as durable from '@earendil-works/pi-durable'
import * as durableEnv from '@earendil-works/pi-durable/env'
import * as durableJsonl from '@earendil-works/pi-durable/storage/jsonl'
import {stmt} from '@/statements'

/**
 * Client-side retries of one provider request on a transient failure (connection reset, 429,
 * 5xx), before the failure counts as the turn's. pi-ai itself defaults to none.
 */
export const PROVIDER_REQUEST_MAX_RETRIES = 2

/** Context for harness calls that must not be cancelled by a caller going away. */
export const CONTEXT = chordContext.BACKGROUND_CONTEXT

/** A file of this many rows is rewritten as one when it is read, which is once per turn. */
const COALESCE_FILE_ROWS = 256

/**
 * The file system Pi Durable's JSONL storage writes a session's store to: the files are rows of
 * `session_durable_files`, scoped to one session. A file is the concatenation of its rows in
 * `seq` order, so the storage's appends (one per commit) are single inserts and never rewrite
 * what is already there. Only the operations that storage uses exist; any other answers
 * `not_supported`.
 */
export function sessionFileSystem(db: Database, sessionId: string): durableEnv.FileSystem {
  const bytesOf = (content: string | Uint8Array): Uint8Array =>
    typeof content === 'string' ? new TextEncoder().encode(content) : content
  const read = (file: string): Uint8Array | undefined => {
    const rows = stmt<{data: Uint8Array}, [string, string]>(
      db,
      `SELECT data FROM session_durable_files WHERE session_id = ? AND file = ? ORDER BY seq ASC`,
    ).all(sessionId, file)
    if (rows.length === 0) return undefined
    const bytes = new Uint8Array(rows.reduce((size, row) => size + row.data.length, 0))
    let offset = 0
    for (const row of rows) {
      bytes.set(row.data, offset)
      offset += row.data.length
    }
    if (rows.length >= COALESCE_FILE_ROWS) write(file, bytes)
    return bytes
  }
  const write = db.transaction((file: string, bytes: Uint8Array): void => {
    stmt(db, `DELETE FROM session_durable_files WHERE session_id = ? AND file = ?`).run([sessionId, file])
    stmt(db, `INSERT INTO session_durable_files (session_id, file, seq, data) VALUES (?, ?, 1, ?)`).run([
      sessionId,
      file,
      bytes,
    ])
  })
  const rename = db.transaction((source: string, destination: string): void => {
    stmt(db, `DELETE FROM session_durable_files WHERE session_id = ? AND file = ?`).run([sessionId, destination])
    stmt(db, `UPDATE session_durable_files SET file = ? WHERE session_id = ? AND file = ?`).run([
      destination,
      sessionId,
      source,
    ])
  })
  const done = durableEnv.ok<void, durableEnv.FileError>(undefined)
  const missing = (file: string) =>
    durableEnv.err<never, durableEnv.FileError>(new durableEnv.FileError('not_found', `No such file: ${file}`, file))

  const used: Partial<durableEnv.FileSystem> = {
    id: `seed-session:${sessionId}`,
    cwd: '',
    absolutePath: async (path) => durableEnv.ok(path),
    joinPath: async (parts) => durableEnv.ok(parts.filter(Boolean).join('/')),
    createDir: async () => done,
    flushFile: async () => done,
    readBinaryFile: async (file) => {
      const bytes = read(file)
      return bytes ? durableEnv.ok(bytes) : missing(file)
    },
    appendFile: async (file, content) => {
      stmt(
        db,
        `INSERT INTO session_durable_files (session_id, file, seq, data)
           SELECT ?1, ?2, COALESCE(MAX(seq), 0) + 1, ?3 FROM session_durable_files WHERE session_id = ?1 AND file = ?2`,
      ).run([sessionId, file, bytesOf(content)])
      return done
    },
    writeFile: async (file, content) => {
      write(file, bytesOf(content))
      return done
    },
    truncateFile: async (file, size) => {
      const bytes = read(file)
      if (!bytes) return missing(file)
      write(file, bytes.slice(0, size))
      return done
    },
    renameFile: async (source, destination) => {
      rename(source, destination)
      return done
    },
    remove: async (file) => {
      stmt(db, `DELETE FROM session_durable_files WHERE session_id = ? AND file = ?`).run([sessionId, file])
      return done
    },
    listDir: async () =>
      durableEnv.ok(
        stmt<{file: string; size: number}, [string]>(
          db,
          `SELECT file, SUM(LENGTH(data)) AS size FROM session_durable_files WHERE session_id = ? GROUP BY file`,
        )
          .all(sessionId)
          .map((row) => ({name: row.file, path: row.file, kind: 'file' as const, size: row.size, mtimeMs: 0})),
      ),
  }
  return new Proxy(used as durableEnv.FileSystem, {
    get: (target, property, receiver) =>
      property in target
        ? Reflect.get(target, property, receiver)
        : async () =>
            durableEnv.err(
              new durableEnv.FileError('not_supported', `Session stores do not support ${String(property)}`),
            ),
  })
}

/** The input that starts a turn, under the request id it is submitted with. */
export type TurnInput = {
  requestId: string
  content: string
  /** The log event the input is the model-facing form of; absent for inputs Seed composed. */
  eventId?: string
}

/** How far a session's log has been imported into its conversation, and the input it last produced. */
export type SyncState = {
  /**
   * Every event at or below this sequence number that the harness did not produce itself is
   * already part of the transcript. Zero means the conversation was never filled from the log.
   */
  importedSeq: number
  /**
   * The input the newest import held back for submission. It is recorded with the import, so an
   * input that was never submitted is still known, and one that was is found by its request id.
   */
  input?: TurnInput
}

/** The sync bookkeeping of a conversation, committed together with what it describes. */
export const SyncDoc = durable.defineDoc<SyncState>({
  kind: 'seed.sync',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({importedSeq: 0}),
})

/** A transcript entry written from the Seed log rather than produced by the harness. */
export const ReplayEntry = durable.defineEntry('seed.replay')

/** Opens (creating it when absent) the durable store of one session and a harness over it. */
export async function openSessionHarness(options: {
  db: Database
  sessionId: string
  models: piAi.Models
  registry: durable.Registry
  /** Receives extension and task failures that do not fail the calling operation. */
  onReport: (error: unknown) => void
}): Promise<durable.Harness> {
  const storage = await durableJsonl.JsonlStorage.open('', sessionFileSystem(options.db, options.sessionId), CONTEXT)
  return durable.Harness.open(
    storage,
    {
      models: options.models,
      registry: options.registry,
      onReport: options.onReport,
      settings: {
        // Seed never replaces history with a summary: a conversation that outgrows its context is
        // carried into a successor session by the agent (`continue_session`).
        compaction: {enabled: false},
        // Retry policy belongs to the run queue: interactive turns fail fast, background runs ride
        // the queue's backoff. Only a single request's transient failures are retried in place.
        retry: {enabled: false},
        stream: {maxRetries: PROVIDER_REQUEST_MAX_RETRIES},
      },
    },
    CONTEXT,
  )
}

/**
 * The model-facing text of a tool result the harness wrote itself (an unavailable tool, rejected
 * arguments, an interrupted or aborted call) without the `<harness>` frame it shows the model.
 */
export function harnessResultText(text: string): string {
  const match = text.match(/^<harness>\n(?:\[[a-z_]+\] )?([\s\S]*)\n<\/harness>$/)
  return match?.[1] ?? text
}

/**
 * Follows the assistant message a generation is streaming and reports the text that is new since
 * the last event. The harness commits partials as changes to one message (appended text, replaced
 * blocks, or the whole message after a retry); callers only want the text to append to a bubble.
 */
export class StreamedTextTracker {
  #blocks: string[] = []
  #emitted = ''

  /** Forgets the message in flight; the next message starts a new stretch of text. */
  reset(): void {
    this.#blocks = []
    this.#emitted = ''
  }

  /** Text shown so far for the message in flight. */
  get text(): string {
    return this.#emitted
  }

  /** Applies one harness event and returns the text it added, or an empty string. */
  apply(event: durable.AgentEvent): string {
    if (event.type === 'message_start') {
      if (event.message.role !== 'assistant') return ''
      this.#blocks = event.message.content.map((block) => (block.type === 'text' ? block.text : ''))
      return this.#delta()
    }
    if (event.type !== 'message_update') return ''
    for (const change of event.changes) {
      if (change.type === 'message') {
        this.#blocks = change.message.content.map((block) => (block.type === 'text' ? block.text : ''))
      } else if (change.type === 'text_delta') {
        this.#blocks[change.contentIndex] = (this.#blocks[change.contentIndex] ?? '') + change.delta
      } else if (change.type === 'text_start' || change.type === 'block') {
        this.#blocks[change.contentIndex] = change.block.type === 'text' ? change.block.text : ''
      }
    }
    return this.#delta()
  }

  #delta(): string {
    const text = this.#blocks.map((block) => block ?? '').join('')
    // Text only ever grows within one message; anything else (a retried attempt replacing the
    // partial) cannot be expressed as an append, so it waits for the message's final text.
    if (!text.startsWith(this.#emitted)) return ''
    const delta = text.slice(this.#emitted.length)
    this.#emitted = text
    return delta
  }
}
