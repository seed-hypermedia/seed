/**
 * Pi Durable storage for agent sessions.
 *
 * Every Seed session owns one Pi Durable Session: an append-only JSONL store under
 * `<stateDir>/session-durable/<sessionId>/`, beside the session's attachments. Its root
 * conversation is the model-facing transcript of the session: exact provider messages (thinking
 * blocks, reasoning items, usage), the positional system prompt, and the checkpoints of the turn
 * in flight. A process that dies mid-turn leaves that work pending in the store, and the run that
 * retries it reopens the store and continues from the last checkpoint.
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
 * When the log holds something that cannot be appended to the conversation as it stands (a result
 * arriving long after its call, a session that predates this store), the conversation's context is
 * rebuilt from the log behind a fresh head; the earlier entries stay in storage.
 *
 * One process owns a store at a time. Only the run that holds the session's turn opens it.
 */

import * as chordContext from '@earendil-works/chord/context'
import type * as piAi from '@earendil-works/pi-ai'
import * as durable from '@earendil-works/pi-durable'
import * as durableJsonl from '@earendil-works/pi-durable/storage/jsonl/node'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Name of the durable session directory inside an agent's state directory. */
export const SESSION_DURABLE_DIR_NAME = 'session-durable'

/**
 * Client-side retries of one provider request on a transient failure (connection reset, 429,
 * 5xx), before the failure counts as the turn's. pi-ai itself defaults to none.
 */
export const PROVIDER_REQUEST_MAX_RETRIES = 2

/** Context for harness calls that must not be cancelled by a caller going away. */
export const CONTEXT = chordContext.BACKGROUND_CONTEXT

/** Returns the durable store directory of one session, validating the session id shape. */
export function sessionDurableDir(stateDir: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Invalid session id')
  return path.join(stateDir, SESSION_DURABLE_DIR_NAME, sessionId)
}

/** Removes a session's durable store. Safe to call when none exists. */
export function deleteSessionDurable(stateDir: string, sessionId: string): void {
  fs.rmSync(sessionDurableDir(stateDir, sessionId), {recursive: true, force: true})
}

/**
 * How far the Seed log has been imported into the conversation: every event at or below
 * `importedSeq` that the harness did not produce itself is already part of the transcript. Zero
 * means the conversation has never been filled from the log.
 */
export const SyncDoc = durable.defineDoc<{importedSeq: number}>({
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
  dir: string
  models: piAi.Models
  registry: durable.Registry
  /** Receives extension and task failures that do not fail the calling operation. */
  onReport: (error: unknown) => void
}): Promise<durable.Harness> {
  const storage = await durableJsonl.openNodeJsonlStorage(options.dir, CONTEXT)
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
