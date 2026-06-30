/**
 * Per-mention XState v5 actor machine.
 *
 * Replaces the implicit two-pass placeholder/finalise loop in `poll-cli.ts`
 * with an explicit lifecycle that supports retry-with-backoff, snapshot/replay
 * on crash, and inspectable state in audit logs.
 *
 * States:
 *   detected → enqueued → placeholder_pending → placeholder_posted →
 *   agent_running → draft_ready → finalising → done
 *
 * Terminal failure states: `failed_terminal`, `skipped_not_allowed`, `cap_exceeded`.
 *
 * Snapshot: each transition appends to `${stateDir}/machines/<mentionId>.jsonl`
 * (event log). On startup the supervisor (`./supervisor.ts`) replays each
 * file's events to rehydrate the machine. The machine itself does not write
 * to disk — the supervisor wires `subscribe()` to a JSONL writer.
 */

import {assign, fromPromise, setup} from 'xstate'
import type {Mention} from '../mentions.js'

const MAX_DRAFT_RETRIES = 3
const MAX_FINALISE_RETRIES = 3
const BASE_BACKOFF_MS = 2_000

export type MentionContext = {
  mention: Mention
  /** Comment id of the placeholder posted in `placeholder_posted`. */
  placeholderId: string | null
  /** Final reply body (DeepSeek output or fallback). */
  replyBody: string | null
  /** Reason for terminal failure. */
  failureReason: string | null
  /** Per-state retry counters. */
  draftRetries: number
  finaliseRetries: number
  /** Last error seen on a transient transition. */
  lastError: string | null
}

export type MentionEvent =
  | {type: 'ENQUEUE'}
  | {type: 'CAP_DENIED'; reason: string}
  | {type: 'NOT_ALLOWED'; reason: string}
  | {type: 'POST_PLACEHOLDER'}
  | {type: 'PLACEHOLDER_POSTED'; placeholderId: string}
  | {type: 'PLACEHOLDER_FAILED'; reason: string}
  | {type: 'RUN_AGENT'}
  | {type: 'AGENT_DONE'; replyBody: string}
  | {type: 'AGENT_ERROR'; reason: string}
  | {type: 'FINALISE'}
  | {type: 'FINALISED'}
  | {type: 'FINALISE_ERROR'; reason: string}

export type MentionInput = {mention: Mention}

/** Caller-provided side effects. The machine has no I/O of its own — the
 *  supervisor injects callbacks that touch the network or seed-cli. */
export type MentionCallbacks = {
  postPlaceholder: (mention: Mention) => Promise<{placeholderId: string}>
  runAgent: (mention: Mention) => Promise<{replyBody: string}>
  finaliseComment: (placeholderId: string, replyBody: string) => Promise<void>
  /** Optional pre-checks. Throw to short-circuit into a terminal state. */
  checkAllowed?: (mention: Mention) => 'allowed' | {reason: string}
  checkCap?: (mention: Mention) => 'allowed' | {reason: string}
}

export const mentionMachine = setup({
  types: {
    context: {} as MentionContext,
    events: {} as MentionEvent,
    input: {} as MentionInput,
  },
  actors: {
    postPlaceholderActor: fromPromise<{placeholderId: string}, {mention: Mention; cb: MentionCallbacks}>(
      async ({input}) => input.cb.postPlaceholder(input.mention),
    ),
    runAgentActor: fromPromise<{replyBody: string}, {mention: Mention; cb: MentionCallbacks}>(
      async ({input}) => input.cb.runAgent(input.mention),
    ),
    finaliseActor: fromPromise<void, {placeholderId: string; replyBody: string; cb: MentionCallbacks}>(
      async ({input}) => input.cb.finaliseComment(input.placeholderId, input.replyBody),
    ),
  },
  guards: {
    canRetryDraft: ({context}) => context.draftRetries < MAX_DRAFT_RETRIES,
    canRetryFinalise: ({context}) => context.finaliseRetries < MAX_FINALISE_RETRIES,
  },
  delays: {
    draftBackoff: ({context}) => BASE_BACKOFF_MS * 2 ** context.draftRetries,
    finaliseBackoff: ({context}) => BASE_BACKOFF_MS * 2 ** context.finaliseRetries,
  },
}).createMachine({
  id: 'mention',
  initial: 'detected',
  context: ({input}) => ({
    mention: input.mention,
    placeholderId: null,
    replyBody: null,
    failureReason: null,
    draftRetries: 0,
    finaliseRetries: 0,
    lastError: null,
  }),
  states: {
    detected: {
      on: {
        ENQUEUE: 'enqueued',
        NOT_ALLOWED: {
          target: 'skipped_not_allowed',
          actions: assign({failureReason: ({event}) => event.reason}),
        },
        CAP_DENIED: {
          target: 'cap_exceeded',
          actions: assign({failureReason: ({event}) => event.reason}),
        },
      },
    },
    enqueued: {
      on: {
        POST_PLACEHOLDER: 'placeholder_pending',
        CAP_DENIED: {
          target: 'cap_exceeded',
          actions: assign({failureReason: ({event}) => event.reason}),
        },
      },
    },
    placeholder_pending: {
      on: {
        PLACEHOLDER_POSTED: {
          target: 'placeholder_posted',
          actions: assign({placeholderId: ({event}) => event.placeholderId}),
        },
        PLACEHOLDER_FAILED: {
          target: 'failed_terminal',
          actions: assign({failureReason: ({event}) => event.reason}),
        },
      },
    },
    placeholder_posted: {
      on: {
        RUN_AGENT: 'agent_running',
      },
    },
    agent_running: {
      on: {
        AGENT_DONE: {
          target: 'draft_ready',
          actions: assign({replyBody: ({event}) => event.replyBody}),
        },
        AGENT_ERROR: [
          {
            guard: 'canRetryDraft',
            target: 'agent_backoff',
            actions: assign({
              draftRetries: ({context}) => context.draftRetries + 1,
              lastError: ({event}) => event.reason,
            }),
          },
          {
            target: 'failed_terminal',
            actions: assign({failureReason: ({event}) => event.reason}),
          },
        ],
      },
    },
    agent_backoff: {
      after: {
        draftBackoff: 'agent_running',
      },
    },
    draft_ready: {
      on: {
        FINALISE: 'finalising',
      },
    },
    finalising: {
      on: {
        FINALISED: 'done',
        FINALISE_ERROR: [
          {
            guard: 'canRetryFinalise',
            target: 'finalise_backoff',
            actions: assign({
              finaliseRetries: ({context}) => context.finaliseRetries + 1,
              lastError: ({event}) => event.reason,
            }),
          },
          {
            target: 'failed_terminal',
            actions: assign({failureReason: ({event}) => event.reason}),
          },
        ],
      },
    },
    finalise_backoff: {
      after: {
        finaliseBackoff: 'finalising',
      },
    },
    done: {type: 'final'},
    skipped_not_allowed: {type: 'final'},
    cap_exceeded: {type: 'final'},
    failed_terminal: {type: 'final'},
  },
})

export type MentionState =
  | 'detected'
  | 'enqueued'
  | 'placeholder_pending'
  | 'placeholder_posted'
  | 'agent_running'
  | 'agent_backoff'
  | 'draft_ready'
  | 'finalising'
  | 'finalise_backoff'
  | 'done'
  | 'skipped_not_allowed'
  | 'cap_exceeded'
  | 'failed_terminal'
