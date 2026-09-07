import {useEffect, useState} from 'react'

/**
 * The agents server's clock, as this client sees it.
 *
 * Every duration the UI ticks is anchored on a stamp the server wrote — a run's `startedAt`, a
 * tool call's `calledAt` — so the "now" it counts up to has to be the server's now as well.
 * Counting up to the local clock instead bakes the two machines' skew into every timer, and a
 * timer started from the moment the client first noticed the work snaps back to zero on reload.
 *
 * The offset is learned from the socket handshake (the server stamps `connectedAt` as it accepts
 * the connection, so that sample is authoritative and resets on every reconnect) and refined by
 * each event that streams in: an event was stamped before it arrived, so its sample can only be
 * low, and the largest one seen is the closest to the truth.
 */
const offsetByServer = new Map<string, number>()

/** Records a server stamp received `localNow`: from the handshake, or from a streamed event. */
export function recordServerClockSample(
  serverUrl: string,
  serverStamp: number,
  source: 'handshake' | 'event',
  localNow = Date.now(),
): void {
  if (!Number.isFinite(serverStamp)) return
  const sample = serverStamp - localNow
  const current = offsetByServer.get(serverUrl)
  if (source === 'handshake' || current === undefined || sample > current) offsetByServer.set(serverUrl, sample)
}

/** Server time minus local time for a server, or zero before the server has been heard from. */
export function serverClockOffset(serverUrl: string | undefined): number {
  return serverUrl ? offsetByServer.get(serverUrl) ?? 0 : 0
}

/** The server's current time, as best this client can tell. */
export function serverNow(serverUrl: string | undefined, localNow = Date.now()): number {
  return localNow + serverClockOffset(serverUrl)
}

/** Forgets every learned offset (tests). */
export function resetServerClocks(): void {
  offsetByServer.clear()
}

/**
 * The server's current time, re-read once a second while `active`. Inactive, it holds the value
 * from its last tick — callers that have stopped counting use the server's end stamp instead.
 */
export function useServerNow(serverUrl: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => serverNow(serverUrl))
  useEffect(() => {
    if (!active) return
    setNow(serverNow(serverUrl))
    const interval = setInterval(() => setNow(serverNow(serverUrl)), 1000)
    return () => clearInterval(interval)
  }, [active, serverUrl])
  return now
}
