import type {AgentActivity, AgentInfo, SessionInfo} from '@seed-hypermedia/agents-protocol'
import {getQueryClient} from '@shm/shared/models/query-client'
import {useQuery} from '@tanstack/react-query'
import {useEffect, useMemo} from 'react'
import type {AgentActivityIndicator, AgentActivityTone} from './activity-dot'
import {useAgentLists, useAgentWebSocketSubscription} from './models'
import {getAgentsPlatform} from './platform'

/**
 * Unread indicator for the agents entry points (desktop title bar, web site header).
 *
 * The server rolls the latest transcript activity up onto each agent (`AgentInfo.activity`), so
 * "is anything unread" needs only the agents list this client already fetches — never a session
 * enumeration. What has been read is this device's business alone: a map of the latest transcript
 * time seen per session, marked while a transcript is actually on screen, plus a baseline set the
 * first time the feature runs so a fresh browser does not light up for weeks of history.
 */

/** Platform setting key holding {@link AgentActivityReadState}. */
export const AGENT_ACTIVITY_READ_KEY = 'agents.activity-read'
/** Sessions remembered per device; the oldest marks are dropped past this. */
const READ_STATE_MAX_SESSIONS = 300
const READ_STATE_QUERY_KEY = ['agents', 'activity-read'] as const

export type AgentActivityReadState = {
  /**
   * Messages at or before this instant count as read everywhere. Set once, from the newest message
   * across the agents known at the time, so the indicator starts quiet on a new device. Undefined
   * until the agent lists have settled once.
   */
  allBefore?: number
  /** Latest transcript time seen per `serverUrl|sessionId`. */
  sessions: Record<string, number>
}

export function agentActivityReadKey(serverUrl: string, sessionId: string): string {
  return `${serverUrl}|${sessionId}`
}

function isReadState(value: unknown): value is AgentActivityReadState {
  if (!value || typeof value !== 'object') return false
  const state = value as {allBefore?: unknown; sessions?: unknown}
  if (state.allBefore !== undefined && typeof state.allBefore !== 'number') return false
  return !!state.sessions && typeof state.sessions === 'object'
}

/** Whether an agent's rollup is unread on this device. Without a baseline nothing is unread yet. */
export function isAgentActivityUnread(
  activity: AgentActivity,
  serverUrl: string,
  read: AgentActivityReadState | undefined,
): boolean {
  if (!read || read.allBefore === undefined) return false
  const seen = Math.max(read.allBefore, read.sessions[agentActivityReadKey(serverUrl, activity.sessionId)] ?? 0)
  return activity.messageAt > seen
}

export type AgentActivityEntry = {serverUrl: string; agent: AgentInfo}

/**
 * The unread tone of one agent on this device — red for the agent's own reply, blue for a message
 * from a person or a trigger — or null when its latest message has been seen. Lists use this to
 * point at the agent (and, through `activity.sessionId`, the session) that keeps the dot lit.
 */
export function agentUnreadTone(
  activity: AgentActivity | undefined,
  serverUrl: string,
  read: AgentActivityReadState | undefined,
): 'agent' | 'user' | null {
  if (!activity || !isAgentActivityUnread(activity, serverUrl, read)) return null
  return activity.messageFrom === 'agent' ? 'agent' : 'user'
}

/** Tooltip-ready sentence for an unread tone. */
export function agentUnreadLabel(tone: 'agent' | 'user', agentName: string): string {
  return tone === 'agent' ? `${agentName} replied` : `New message for ${agentName}`
}

/** One agent's own indicator, as a list row shows it: unread first, else amber while it works. */
export type AgentRowActivity = {tone: AgentActivityTone; unread: boolean; label: string; short: string}

/**
 * The indicator for one agent on this device: its unread tone (red reply, blue message) when its
 * latest message is unseen, amber while any of its runs is live, otherwise nothing. The same rule
 * the title-bar dot applies across agents, applied to a single row.
 */
export function agentRowActivity(
  activity: AgentActivity | undefined,
  serverUrl: string,
  agentName: string,
  read: AgentActivityReadState | undefined,
): AgentRowActivity | null {
  const unreadTone = agentUnreadTone(activity, serverUrl, read)
  if (unreadTone) {
    return {
      tone: unreadTone,
      unread: true,
      label: agentUnreadLabel(unreadTone, agentName),
      short: unreadTone === 'agent' ? 'New reply' : 'New message',
    }
  }
  if (activity?.busy) {
    const tool = activity.kind === 'tool'
    return {
      tone: 'busy',
      unread: false,
      label: tool ? `${agentName} is running a tool` : `${agentName} is working`,
      short: tool ? 'Running a tool' : 'Working',
    }
  }
  return null
}

/**
 * Resolves the agents' rollups and this device's read marks into one indicator: the newest unread
 * message wins (red for the agent's reply, blue for a person's or a trigger's); otherwise a busy
 * agent shows amber; otherwise nothing.
 */
export function summarizeAgentActivity(
  entries: AgentActivityEntry[],
  read: AgentActivityReadState | undefined,
): AgentActivityIndicator | null {
  let unread: (AgentActivityEntry & {activity: AgentActivity}) | null = null
  let busy: (AgentActivityEntry & {activity: AgentActivity}) | null = null
  for (const entry of entries) {
    const activity = entry.agent.activity
    if (!activity) continue
    if (isAgentActivityUnread(activity, entry.serverUrl, read)) {
      if (!unread || activity.messageAt > unread.activity.messageAt) unread = {...entry, activity}
    }
    if (activity.busy && (!busy || activity.at > busy.activity.at)) busy = {...entry, activity}
  }
  const pick = unread ?? busy
  if (!pick) return null
  const agentName = pick.agent.definition.name
  if (unread) {
    const tone = unread.activity.messageFrom === 'agent' ? 'agent' : 'user'
    return {
      tone,
      unread: true,
      serverUrl: unread.serverUrl,
      agentId: unread.agent.id,
      agentName,
      sessionId: unread.activity.sessionId,
      label: agentUnreadLabel(tone, agentName),
    }
  }
  return {
    tone: 'busy',
    unread: false,
    serverUrl: pick.serverUrl,
    agentId: pick.agent.id,
    agentName,
    sessionId: pick.activity.sessionId,
    label: pick.activity.kind === 'tool' ? `${agentName} is running a tool` : `${agentName} is working`,
  }
}

/**
 * One session's own indicator, as a session list shows it: its unread tone when its latest message
 * is unseen on this device, amber while the agent is streaming in it, otherwise nothing (the plain
 * status dot). `agentActivity` — the agent's rollup — names the tool when the busy session is the
 * one it points at.
 */
export function sessionRowActivity(
  session: SessionInfo,
  serverUrl: string,
  read: AgentActivityReadState | undefined,
  agentActivity?: AgentActivity,
): AgentRowActivity | null {
  const message = session.activity
  if (message && read && read.allBefore !== undefined) {
    const seen = Math.max(read.allBefore, read.sessions[agentActivityReadKey(serverUrl, session.id)] ?? 0)
    if (message.messageAt > seen) {
      const tone = message.messageFrom === 'agent' ? 'agent' : 'user'
      return {
        tone,
        unread: true,
        label: tone === 'agent' ? 'Unread reply' : 'Unread message',
        short: tone === 'agent' ? 'New reply' : 'New message',
      }
    }
  }
  if (session.status === 'streaming') {
    const tool = agentActivity?.sessionId === session.id && agentActivity.kind === 'tool' && agentActivity.busy
    return {
      tone: 'busy',
      unread: false,
      label: tool ? 'Running a tool' : 'Working',
      short: tool ? 'Running a tool' : 'Working',
    }
  }
  return null
}

/** The device's read marks, loaded once from the platform setting. */
export function useAgentActivityReadState() {
  return useQuery({
    queryKey: READ_STATE_QUERY_KEY,
    queryFn: async (): Promise<AgentActivityReadState> => {
      const stored = await getAgentsPlatform().getSetting(AGENT_ACTIVITY_READ_KEY)
      return isReadState(stored) ? stored : {sessions: {}}
    },
    staleTime: Infinity,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Writes the read marks to the cache (so indicators update at once) and to the device setting. */
function writeReadState(next: AgentActivityReadState): void {
  const keys = Object.keys(next.sessions)
  const sessions =
    keys.length > READ_STATE_MAX_SESSIONS
      ? Object.fromEntries(
          keys
            .sort((a, b) => next.sessions[b]! - next.sessions[a]!)
            .slice(0, READ_STATE_MAX_SESSIONS)
            .map((key) => [key, next.sessions[key]!]),
        )
      : next.sessions
  const state = {...next, sessions}
  getQueryClient().setQueryData(READ_STATE_QUERY_KEY, state)
  void getAgentsPlatform()
    .setSetting(AGENT_ACTIVITY_READ_KEY, state)
    .catch(() => {
      // A full or unavailable store loses nothing but a future dot; the cache is already current.
    })
}

/**
 * Marks a session read up to `seenAt` right now — for the moment a user picks an agent whose
 * unread session the panel is about to show, so the indicators clear without waiting on the
 * transcript to load. The transcript view then keeps the mark current as events arrive.
 */
export function markAgentSessionRead(serverUrl: string, sessionId: string, seenAt: number): void {
  const current = getQueryClient().getQueryData<AgentActivityReadState>(READ_STATE_QUERY_KEY) ?? {sessions: {}}
  const key = agentActivityReadKey(serverUrl, sessionId)
  if ((current.sessions[key] ?? 0) >= seenAt) return
  writeReadState({...current, sessions: {...current.sessions, [key]: seenAt}})
}

/**
 * Records that this device has seen a session's transcript up to `latestEventAt` — the newest
 * event time the view has rendered, in the server's clock, which is what the rollup's
 * `messageAt` is measured in. Only while the document is visible: a transcript left open in a
 * background tab has not been read.
 */
export function useMarkAgentSessionRead(
  serverUrl: string | undefined,
  sessionId: string | undefined,
  latestEventAt: number | undefined,
): void {
  const read = useAgentActivityReadState()
  const stored = read.data
  useEffect(() => {
    if (!serverUrl || !sessionId || !latestEventAt || !stored) return
    const key = agentActivityReadKey(serverUrl, sessionId)
    const mark = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const current = getQueryClient().getQueryData<AgentActivityReadState>(READ_STATE_QUERY_KEY) ?? stored
      if ((current.sessions[key] ?? 0) >= latestEventAt) return
      writeReadState({...current, sessions: {...current.sessions, [key]: latestEventAt}})
    }
    mark()
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [serverUrl, sessionId, latestEventAt, stored])
}

/** The newest event time in a transcript, for {@link useMarkAgentSessionRead}. */
export function latestSessionEventAt(events: {createdAt?: number}[] | undefined): number | undefined {
  let latest: number | undefined
  for (const event of events ?? []) {
    if (typeof event.createdAt === 'number' && (latest === undefined || event.createdAt > latest))
      latest = event.createdAt
  }
  return latest
}

/**
 * The indicator for the given servers' agents, kept current by the agent lists (which the account
 * sockets update in place from the server's activity hints) and this device's read marks.
 */
export function useAgentActivityIndicator(
  serverUrls: string[] | undefined,
  accountUid: string | null | undefined,
): AgentActivityIndicator | null {
  const lists = useAgentLists(serverUrls, accountUid)
  const read = useAgentActivityReadState()
  const settled = lists.length > 0 && lists.every((query) => query.isSuccess || query.isError)
  // Cheap enough to rebuild per render (a handful of agents); useQueries hands back a fresh array
  // anyway, so memoizing on it would buy nothing.
  const entries = (serverUrls ?? []).flatMap((serverUrl, index) =>
    (lists[index]?.data ?? []).map((agent): AgentActivityEntry => ({serverUrl, agent})),
  )

  // First run on this device: everything that already happened is read. The baseline is the newest
  // message known right now, in the server's clock, rather than this device's clock.
  const stored = read.data
  const newestMessageAt = Math.max(0, ...entries.map((entry) => entry.agent.activity?.messageAt ?? 0))
  useEffect(() => {
    if (!stored || stored.allBefore !== undefined || !settled) return
    writeReadState({...stored, allBefore: newestMessageAt})
  }, [stored, settled, newestMessageAt])

  // Referentially stable while nothing changed: consumers report it upward through effects and
  // context, and a fresh object per render would make those fire every render.
  const indicator = summarizeAgentActivity(entries, read.data)
  const signature = JSON.stringify(indicator)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => indicator, [signature])
}

/** Keeps one account-wide socket per server open, so activity hints arrive with the panel closed. */
export function AgentActivityLiveUpdates({
  serverUrls,
  accountUid,
}: {
  serverUrls: string[] | undefined
  accountUid: string | null | undefined
}) {
  if (!accountUid) return null
  return (
    <>
      {(serverUrls ?? []).map((serverUrl) => (
        <AgentAccountLiveUpdates key={serverUrl} serverUrl={serverUrl} accountUid={accountUid} />
      ))}
    </>
  )
}

/**
 * Account-wide live updates for one server: session changes (titles, statuses, activity) reach
 * every list the moment they happen, instead of waiting on a background poll.
 */
export function AgentAccountLiveUpdates({serverUrl, accountUid}: {serverUrl: string; accountUid: string}) {
  useAgentWebSocketSubscription(serverUrl, accountUid, `account/${accountUid}`)
  return null
}
