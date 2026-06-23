/**
 * Supervisor for per-mention machines. Loads pending state from disk on
 * startup, spawns one machine per mention, persists every transition to a
 * JSONL event log, and rehydrates machines after a crash.
 *
 * The supervisor is the only component that touches `${stateDir}/machines/`.
 * Each mention has a dedicated event log:
 *
 *   ${stateDir}/machines/<mentionKey>.jsonl
 *
 * Each line is `{ts, type, payload}`. Replay = create a fresh machine with
 * the original input, then `actor.send(event)` for each persisted event.
 */

import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {createActor, type Actor} from 'xstate'
import {mentionMachine, type MentionCallbacks, type MentionEvent} from './mention-machine.js'
import type {Mention} from '../mentions.js'
import {mentionKey} from '../state.js'
import type {TelemetryKind} from '../observability.js'

const MACHINES_SUBDIR = 'machines'

type PersistedEvent = {
  ts: string
  type: MentionEvent['type']
  payload?: Record<string, unknown>
  /** Captured on the very first line so replay can reconstruct context. */
  initialMention?: Mention
}

export class MentionSupervisor {
  private readonly machinesDir: string
  private readonly actors = new Map<string, Actor<typeof mentionMachine>>()
  private readonly callbacks: MentionCallbacks
  private readonly telemetry?: (kind: Extract<TelemetryKind, 'machine_event' | 'machine_snapshot'>, data: unknown) => void
  private readonly runId?: string

  constructor(
    stateDir: string,
    callbacks: MentionCallbacks,
    opts: {
      telemetry?: (kind: Extract<TelemetryKind, 'machine_event' | 'machine_snapshot'>, data: unknown) => void
      runId?: string
    } = {},
  ) {
    this.callbacks = callbacks
    void this.callbacks
    this.telemetry = opts.telemetry
    this.runId = opts.runId
    this.machinesDir = join(stateDir, MACHINES_SUBDIR)
    if (!existsSync(this.machinesDir)) {
      mkdirSync(this.machinesDir, {recursive: true, mode: 0o700})
    }
  }

  /** Returns true when this mention already has a non-terminal actor. */
  has(mention: Mention): boolean {
    const id = mentionKey(mention)
    return this.actors.has(id)
  }

  /** Spawn a fresh machine for a newly-detected mention. */
  spawn(mention: Mention): Actor<typeof mentionMachine> {
    const id = mentionKey(mention)
    if (this.actors.has(id)) return this.actors.get(id)!

    // First line of the log captures the input mention so replay can
    // reconstruct identical machine context.
    this.persist(id, {ts: new Date().toISOString(), type: 'ENQUEUE', initialMention: mention})

    const actor = this.createActor(mention, id)
    actor.start()
    this.emitMachineEvent('actor_spawned', mention, id, {trigger: 'fresh'})
    return actor
  }

  /** Send an event to a mention's actor. Auto-persists, then forwards. */
  send(mention: Mention, event: MentionEvent): void {
    const id = mentionKey(mention)
    const actor = this.actors.get(id)
    if (!actor) return
    this.persist(id, {ts: new Date().toISOString(), type: event.type, payload: extractPayload(event)})
    this.emitMachineEvent('actor_event', mention, id, {type: event.type, payload: extractPayload(event)})
    actor.send(event)
  }

  /** Read all *.jsonl files and replay them into fresh actors. Drops actors
   *  whose final event is a terminal state (they are already done). */
  rehydrate(): {restored: number; skipped: number} {
    if (!existsSync(this.machinesDir)) return {restored: 0, skipped: 0}
    let restored = 0
    let skipped = 0
    for (const file of readdirSync(this.machinesDir)) {
      if (!file.endsWith('.jsonl')) continue
      const lines = readFileSync(join(this.machinesDir, file), 'utf-8')
        .split('\n')
        .filter(Boolean)
      if (lines.length === 0) continue
      let initialMention: Mention | null = null
      const events: MentionEvent[] = []
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as PersistedEvent
          if (parsed.initialMention && !initialMention) {
            initialMention = parsed.initialMention
          }
          // Skip the bootstrap ENQUEUE line — it's a marker, not a real event;
          // creating the actor naturally starts in the `detected` state and
          // an ENQUEUE event from the next entry takes it to `enqueued`.
          if (parsed.initialMention) continue
          events.push(reconstructEvent(parsed))
        } catch {
          // Corrupt line — best-effort skip.
        }
      }
      if (!initialMention) {
        skipped++
        continue
      }
      // Derive the original (unsanitized) mention id from the persisted
      // initialMention so the in-memory actor map keys match what later
      // spawn()/send() calls compute via mentionKey().
      const id = mentionKey(initialMention)
      const actor = this.createActor(initialMention, id, {silent: true})
      actor.start()
      for (const e of events) {
        actor.send(e)
      }
      const snapshot = actor.getSnapshot()
      if (snapshot.status === 'done') {
        actor.stop()
        this.actors.delete(id)
        this.emitMachineEvent('actor_rehydrated_terminal', initialMention, id, {status: snapshot.status})
        skipped++
      } else {
        this.emitMachineEvent('actor_rehydrated', initialMention, id, {status: snapshot.status})
        restored++
      }
    }
    return {restored, skipped}
  }

  /** Stop all actors. Called on graceful shutdown. */
  stopAll(): void {
    for (const [id, actor] of this.actors.entries()) {
      actor.stop()
      this.telemetry?.('machine_event', {
        event: 'actor_stopped',
        ts: new Date().toISOString(),
        runId: this.runId,
        actorId: id,
        mentionId: id,
      })
    }
    this.actors.clear()
  }

  private createActor(mention: Mention, id: string, opts: {silent?: boolean} = {}): Actor<typeof mentionMachine> {
    const actor = createActor(mentionMachine, {input: {mention}})
    this.actors.set(id, actor)
    actor.subscribe((snapshot) => {
      if (!opts.silent) this.emitSnapshot(mention, id, snapshot)
      if (snapshot.status === 'done') {
        // Terminal — drop the actor. The JSONL log stays as audit trail.
        setImmediate(() => {
          actor.stop()
          this.actors.delete(id)
          this.emitMachineEvent('actor_stopped', mention, id, {status: snapshot.status})
        })
      }
    })
    return actor
  }

  private emitMachineEvent(event: string, mention: Mention, id: string, data: Record<string, unknown> = {}): void {
    this.telemetry?.('machine_event', {
      event,
      ts: new Date().toISOString(),
      runId: this.runId,
      actorId: id,
      mentionId: id,
      commentId: mention.commentId,
      docId: mention.docId,
      kind: mention.kind,
      ...data,
    })
  }

  private emitSnapshot(mention: Mention, id: string, snapshot: unknown): void {
    const snap = isRecord(snapshot) ? snapshot : {}
    const context = isRecord(snap.context) ? snap.context : {}
    this.telemetry?.('machine_snapshot', {
      event: 'actor_snapshot',
      ts: new Date().toISOString(),
      runId: this.runId,
      actorId: id,
      mentionId: id,
      commentId: mention.commentId,
      docId: mention.docId,
      state: snap.value,
      status: snap.status,
      context: {
        placeholderId: context.placeholderId,
        draftRetries: context.draftRetries,
        finaliseRetries: context.finaliseRetries,
        failureReason: context.failureReason,
        lastError: context.lastError,
      },
    })
  }

  private persist(id: string, event: PersistedEvent): void {
    const path = join(this.machinesDir, `${sanitizeForFs(id)}.jsonl`)
    appendFileSync(path, JSON.stringify(event) + '\n', {mode: 0o600})
  }
}

/** Mention ids include "/" (commentId is "<author>/<tsid>"). Replace any
 *  filesystem-unfriendly chars so the per-mention JSONL stays a single file
 *  under the machines/ directory. */
function sanitizeForFs(id: string): string {
  return id.replace(/[/\\:]/g, '_')
}

function extractPayload(event: MentionEvent): Record<string, unknown> | undefined {
  const {type: _type, ...rest} = event as Record<string, unknown> & {type: string}
  return Object.keys(rest).length ? rest : undefined
}

function reconstructEvent(persisted: PersistedEvent): MentionEvent {
  const base = {type: persisted.type as MentionEvent['type']}
  return {...base, ...(persisted.payload ?? {})} as MentionEvent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
