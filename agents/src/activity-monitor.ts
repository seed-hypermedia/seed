import type * as api from '@/api'
import type * as apisvc from '@/api-service'
import * as activityTriggers from '@/activity-triggers'
import * as cbor from '@/cbor'
import {PollLoop} from '@/poll-loop'
import {createSeedClient, type SeedClient} from '@seed-hypermedia/client'
import type {Database} from 'bun:sqlite'

/** Options for the background HM activity monitor. */
export type ActivityMonitorOptions = {
  hmServerUrl: string
  pollIntervalMs: number
  pageSize: number
  maxPagesPerPoll: number
  /** Per-request timeout for ListEvents; a hung fetch is aborted so it can't wedge the loop. Default 20s. */
  requestTimeoutMs?: number
  /** Safety-net timeout for a whole poll cycle, enforced by {@link PollLoop}. Default 60s. */
  pollTimeoutMs?: number
  client?: Pick<SeedClient, 'request'>
}

const ACTIVITY_BACKFILL_MS = 60 * 60 * 1000
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_POLL_TIMEOUT_MS = 60_000

type Watermark = {seenKeys: string[]; lastSuccessAt?: number}

type EnabledTriggerRow = {account_id: string; created_at: number; source_cbor: Uint8Array}

/** Polls HM ActivityFeed and asks the agent service to fire matching triggers. */
export class ActivityMonitor {
  readonly #db: Database
  readonly #service: apisvc.Service
  readonly #options: ActivityMonitorOptions
  readonly #loop: PollLoop

  constructor(db: Database, service: apisvc.Service, options: ActivityMonitorOptions) {
    this.#db = db
    this.#service = service
    this.#options = options
    this.#loop = new PollLoop({
      label: 'Agents Activity',
      intervalMs: options.pollIntervalMs,
      timeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      run: () => this.pollOnce(),
    })
  }

  /** Starts polling until `stop()` is called. */
  start(): void {
    this.#loop.start()
  }

  /** Stops future polls. An in-flight poll is allowed to finish. */
  stop(): void {
    this.#loop.stop()
  }

  /** Runs one polling cycle for all accounts that have enabled triggers. */
  async pollOnce(): Promise<void> {
    for (const accountId of this.#enabledTriggerAccounts()) {
      await this.#pollAccount(accountId)
    }
  }

  async #pollAccount(accountId: string): Promise<void> {
    const startedAt = Date.now()
    const client = this.#options.client ?? createSeedClient(this.#options.hmServerUrl)
    const previous = this.#getWatermark(accountId)
    const fetched: activityTriggers.ActivityFeedEvent[] = []
    let pageToken: string | undefined
    try {
      console.log('[Agents Activity] Polling feed', {
        accountId,
        serverUrl: this.#options.hmServerUrl,
        pageSize: this.#options.pageSize,
        maxPages: this.#options.maxPagesPerPoll,
        previousSeenKeys: previous?.seenKeys.length || 0,
        previousSuccessAt: previous?.lastSuccessAt,
      })
      for (let page = 0; page < this.#options.maxPagesPerPoll; page += 1) {
        const response = await client.request(
          'ListEvents',
          {
            pageSize: this.#options.pageSize,
            pageToken,
            currentAccount: accountId,
          },
          {signal: AbortSignal.timeout(this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)},
        )
        const events = Array.isArray(response.events) ? (response.events as activityTriggers.ActivityFeedEvent[]) : []
        fetched.push(...events)
        console.log('[Agents Activity] Feed page received', {
          accountId,
          page: page + 1,
          events: events.length,
          sample: events.slice(0, 3).map((event) => activityTriggers.activityDebugInfo(event)),
          hasNextPage: !!response.nextPageToken,
        })
        pageToken = response.nextPageToken || undefined
        if (!pageToken) break
        if (
          previous &&
          events.some((event) => previous.seenKeys.includes(activityTriggers.activityEventKey(event) || ''))
        ) {
          break
        }
      }

      const seenKeys = uniqueKeys(fetched).slice(0, this.#options.pageSize)
      if (!previous) {
        const firstRunEvents = fetched.filter((event) => {
          const eventAt = activityTriggers.activityEventTimeMs(event)
          return eventAt !== null && eventAt >= this.#earliestEnabledTriggerCreatedAt(accountId)
        })
        console.log('[Agents Activity] First poll processing events', {
          accountId,
          fetched: fetched.length,
          processing: firstRunEvents.length,
          earliestTriggerCreatedAt: this.#earliestEnabledTriggerCreatedAt(accountId),
        })
        for (const event of firstRunEvents.reverse()) {
          await this.#service.processActivityEvent(accountId, event)
        }
        this.#setWatermark(accountId, {seenKeys}, startedAt, Date.now())
        return
      }

      const backfillAfter = Math.max(previous.lastSuccessAt || 0, startedAt - ACTIVITY_BACKFILL_MS)
      const newEvents = fetched.filter((event) => {
        const key = activityTriggers.activityEventKey(event)
        if (!key || previous.seenKeys.includes(key)) return false
        const eventAt = activityTriggers.activityEventTimeMs(event)
        return eventAt === null || eventAt >= backfillAfter
      })
      console.log('[Agents Activity] Processing feed events', {
        accountId,
        fetched: fetched.length,
        newEvents: newEvents.length,
        backfillAfter,
        remainingPageToken: pageToken,
        newEventSamples: newEvents.slice(0, 5).map((event) => activityTriggers.activityDebugInfo(event)),
      })
      for (const event of newEvents.reverse()) {
        await this.#service.processActivityEvent(accountId, event)
      }
      this.#setWatermark(accountId, {seenKeys}, startedAt, Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Agents Activity] Poll failed', {accountId, serverUrl: this.#options.hmServerUrl, error: message})
      this.#recordWatermarkError(accountId, startedAt, message)
    }
  }

  #earliestEnabledTriggerCreatedAt(accountId: string): number {
    const createdAt = this.#enabledActivityTriggerRows()
      .filter((row) => row.account_id === accountId)
      .reduce<number | null>(
        (earliest, row) => (earliest === null ? row.created_at : Math.min(earliest, row.created_at)),
        null,
      )
    return createdAt ?? Number.MAX_SAFE_INTEGER
  }

  #enabledTriggerAccounts(): string[] {
    return Array.from(new Set(this.#enabledActivityTriggerRows().map((row) => row.account_id)))
  }

  #enabledActivityTriggerRows(): EnabledTriggerRow[] {
    return this.#db
      .query<EnabledTriggerRow, []>(`SELECT account_id, created_at, source_cbor FROM agent_triggers WHERE enabled = 1`)
      .all()
      .filter((row) => cbor.decode<api.AgentTriggerSource>(row.source_cbor).type !== 'schedule')
  }

  #getWatermark(accountId: string): Watermark | null {
    const row = this.#db
      .query<{cursor_cbor: Uint8Array; last_success_at: number | null}, [string, string]>(
        `SELECT cursor_cbor, last_success_at FROM activity_watermarks WHERE account_id = ? AND server_url = ?`,
      )
      .get(accountId, this.#options.hmServerUrl)
    if (!row) return null
    const decoded = cbor.decode<Watermark>(row.cursor_cbor)
    return Array.isArray(decoded.seenKeys)
      ? {
          seenKeys: decoded.seenKeys.filter((key) => typeof key === 'string'),
          ...(row.last_success_at ? {lastSuccessAt: row.last_success_at} : {}),
        }
      : null
  }

  #setWatermark(accountId: string, watermark: Watermark, lastPollAt: number, lastSuccessAt: number): void {
    this.#db.run(
      `INSERT INTO activity_watermarks (account_id, server_url, cursor_cbor, last_poll_at, last_success_at, last_error)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(account_id, server_url) DO UPDATE SET
         cursor_cbor = excluded.cursor_cbor,
         last_poll_at = excluded.last_poll_at,
         last_success_at = excluded.last_success_at,
         last_error = NULL`,
      [accountId, this.#options.hmServerUrl, cbor.encode(watermark), lastPollAt, lastSuccessAt],
    )
  }

  #recordWatermarkError(accountId: string, lastPollAt: number, error: string): void {
    this.#db.run(
      `INSERT INTO activity_watermarks (account_id, server_url, cursor_cbor, last_poll_at, last_error)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, server_url) DO UPDATE SET
         last_poll_at = excluded.last_poll_at,
         last_error = excluded.last_error`,
      [accountId, this.#options.hmServerUrl, cbor.encode({seenKeys: []} satisfies Watermark), lastPollAt, error],
    )
  }
}

function uniqueKeys(events: activityTriggers.ActivityFeedEvent[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const event of events) {
    const key = activityTriggers.activityEventKey(event)
    if (!key || seen.has(key)) continue
    keys.push(key)
    seen.add(key)
  }
  return keys
}
