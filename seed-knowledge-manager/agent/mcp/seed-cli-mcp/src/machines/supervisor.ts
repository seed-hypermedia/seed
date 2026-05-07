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

  constructor(stateDir: string, callbacks: MentionCallbacks) {
    this.callbacks = callbacks
    void this.callbacks
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
    return actor
  }

  /** Send an event to a mention's actor. Auto-persists, then forwards. */
  send(mention: Mention, event: MentionEvent): void {
    const id = mentionKey(mention)
    const actor = this.actors.get(id)
    if (!actor) return
    this.persist(id, {ts: new Date().toISOString(), type: event.type, payload: extractPayload(event)})
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
      const id = file.slice(0, -'.jsonl'.length)
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
      const actor = this.createActor(initialMention, id, {silent: true})
      actor.start()
      for (const e of events) {
        actor.send(e)
      }
      const snapshot = actor.getSnapshot()
      if (snapshot.status === 'done') {
        actor.stop()
        this.actors.delete(id)
        skipped++
      } else {
        restored++
      }
    }
    return {restored, skipped}
  }

  /** Stop all actors. Called on graceful shutdown. */
  stopAll(): void {
    for (const actor of this.actors.values()) actor.stop()
    this.actors.clear()
  }

  private createActor(mention: Mention, id: string, opts: {silent?: boolean} = {}): Actor<typeof mentionMachine> {
    const actor = createActor(mentionMachine, {input: {mention}})
    this.actors.set(id, actor)
    actor.subscribe((snapshot) => {
      if (snapshot.status === 'done') {
        // Terminal — drop the actor. The JSONL log stays as audit trail.
        setImmediate(() => {
          actor.stop()
          this.actors.delete(id)
        })
      }
    })
    void opts
    return actor
  }

  private persist(id: string, event: PersistedEvent): void {
    const path = join(this.machinesDir, `${id}.jsonl`)
    appendFileSync(path, JSON.stringify(event) + '\n', {mode: 0o600})
  }
}

function extractPayload(event: MentionEvent): Record<string, unknown> | undefined {
  const {type: _type, ...rest} = event as Record<string, unknown> & {type: string}
  return Object.keys(rest).length ? rest : undefined
}

function reconstructEvent(persisted: PersistedEvent): MentionEvent {
  const base = {type: persisted.type as MentionEvent['type']}
  return {...base, ...(persisted.payload ?? {})} as MentionEvent
}
