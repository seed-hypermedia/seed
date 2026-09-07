import {afterEach, describe, expect, it} from 'vitest'
import {recordServerClockSample, resetServerClocks, serverClockOffset, serverNow} from '../agents/server-clock'

const SERVER = 'http://agents.test'

describe('server clock', () => {
  afterEach(() => {
    resetServerClocks()
  })

  it('assumes no skew for a server it has not heard from', () => {
    expect(serverClockOffset(SERVER)).toBe(0)
    expect(serverClockOffset(undefined)).toBe(0)
    expect(serverNow(SERVER, 1_000)).toBe(1_000)
  })

  it('takes the handshake stamp as the offset, ahead or behind', () => {
    recordServerClockSample(SERVER, 10_000, 'handshake', 7_000)
    expect(serverClockOffset(SERVER)).toBe(3_000)
    expect(serverNow(SERVER, 8_000)).toBe(11_000)

    recordServerClockSample(SERVER, 5_000, 'handshake', 7_000)
    expect(serverClockOffset(SERVER)).toBe(-2_000)
  })

  it('lets an event stamp raise the offset but never lower it', () => {
    recordServerClockSample(SERVER, 10_000, 'handshake', 7_000)
    // Stamped before it arrived: a low sample says nothing new.
    recordServerClockSample(SERVER, 9_500, 'event', 7_500)
    expect(serverClockOffset(SERVER)).toBe(3_000)
    // A sample that arrived faster than the handshake did is closer to the truth.
    recordServerClockSample(SERVER, 10_600, 'event', 7_500)
    expect(serverClockOffset(SERVER)).toBe(3_100)
  })

  it('learns from events alone before any handshake, and resets on the next handshake', () => {
    recordServerClockSample(SERVER, 2_000, 'event', 1_000)
    expect(serverClockOffset(SERVER)).toBe(1_000)
    recordServerClockSample(SERVER, 1_000, 'handshake', 1_000)
    expect(serverClockOffset(SERVER)).toBe(0)
  })

  it('keeps one offset per server and ignores a non-finite stamp', () => {
    recordServerClockSample(SERVER, 10_000, 'handshake', 7_000)
    recordServerClockSample('http://other.test', 1_000, 'handshake', 7_000)
    expect(serverClockOffset(SERVER)).toBe(3_000)
    expect(serverClockOffset('http://other.test')).toBe(-6_000)
    recordServerClockSample(SERVER, Number.NaN, 'handshake', 7_000)
    expect(serverClockOffset(SERVER)).toBe(3_000)
  })
})
