import {describe, expect, test} from 'vitest'
import type {AgentInfo} from '@seed-hypermedia/agents-protocol'
import {
  agentActivityReadKey,
  agentRowActivity,
  isAgentActivityUnread,
  latestSessionEventAt,
  summarizeAgentActivity,
  type AgentActivityReadState,
} from '../agents/activity'

/**
 * The unread indicator: what the server's per-agent activity rollup and this device's read marks
 * resolve to. Tool activity never counts as unread; the newest unread message picks the color;
 * a busy agent shows only when nothing is unread.
 */

const server = 'https://agents.example'

function agent(id: string, activity?: AgentInfo['activity']): {serverUrl: string; agent: AgentInfo} {
  return {
    serverUrl: server,
    agent: {
      id,
      account: 'z6MkOwner',
      definition: {name: `Agent ${id}`} as AgentInfo['definition'],
      stateDir: '',
      status: 'idle',
      createdAt: 0,
      updatedAt: 0,
      ...(activity ? {activity} : {}),
    },
  }
}

const read = (allBefore: number | undefined, sessions: Record<string, number> = {}): AgentActivityReadState => ({
  ...(allBefore === undefined ? {} : {allBefore}),
  sessions,
})

describe('agent activity indicator', () => {
  test('nothing is unread before the first-run baseline exists, so a fresh device starts quiet', () => {
    const entries = [
      agent('a', {at: 50, kind: 'agent', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: false}),
    ]
    expect(summarizeAgentActivity(entries, undefined)).toBeNull()
    expect(summarizeAgentActivity(entries, read(undefined))).toBeNull()
  })

  test('an unread agent reply is red, an unread human or trigger message is blue', () => {
    const reply = agent('a', {at: 50, kind: 'agent', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: false})
    expect(summarizeAgentActivity([reply], read(10))).toMatchObject({
      tone: 'agent',
      unread: true,
      agentId: 'a',
      sessionId: 's',
      label: 'Agent a replied',
    })
    const asked = agent('b', {at: 50, kind: 'user', messageAt: 50, messageFrom: 'user', sessionId: 't', busy: true})
    expect(summarizeAgentActivity([asked], read(10))).toMatchObject({tone: 'user', unread: true, agentId: 'b'})
  })

  test('the newest unread message across agents decides the color', () => {
    const older = agent('a', {at: 50, kind: 'agent', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: false})
    const newer = agent('b', {at: 80, kind: 'user', messageAt: 80, messageFrom: 'user', sessionId: 't', busy: false})
    expect(summarizeAgentActivity([older, newer], read(10))).toMatchObject({tone: 'user', agentId: 'b'})
  })

  test('reading the session the rollup points at clears it; the baseline covers everything before it', () => {
    const activity = {at: 50, kind: 'agent', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: false} as const
    expect(isAgentActivityUnread(activity, server, read(10))).toBe(true)
    expect(isAgentActivityUnread(activity, server, read(10, {[agentActivityReadKey(server, 's')]: 50}))).toBe(false)
    expect(isAgentActivityUnread(activity, server, read(10, {[agentActivityReadKey(server, 'other')]: 99}))).toBe(true)
    expect(isAgentActivityUnread(activity, server, read(50))).toBe(false)
  })

  test('tool activity after a read message does not reopen it, and a busy agent shows amber instead', () => {
    // The agent is running a tool after the reply the user already saw: `at` moved, `messageAt` did not.
    const working = agent('a', {at: 90, kind: 'tool', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: true})
    const marks = read(10, {[agentActivityReadKey(server, 's')]: 50})
    expect(summarizeAgentActivity([working], marks)).toMatchObject({
      tone: 'busy',
      unread: false,
      label: 'Agent a is running a tool',
    })
    const thinking = agent('a', {at: 90, kind: 'user', messageAt: 50, messageFrom: 'user', sessionId: 's', busy: true})
    expect(summarizeAgentActivity([thinking], marks)).toMatchObject({tone: 'busy', label: 'Agent a is working'})
  })

  test('an idle agent with everything read shows nothing', () => {
    const quiet = agent('a', {at: 50, kind: 'agent', messageAt: 50, messageFrom: 'agent', sessionId: 's', busy: false})
    expect(summarizeAgentActivity([quiet, agent('b')], read(60))).toBeNull()
  })

  test('a list row shows its agent’s own indicator: unread first, then working, then nothing', () => {
    const unreadBusy = {at: 90, kind: 'tool', messageAt: 80, messageFrom: 'agent', sessionId: 's', busy: true} as const
    expect(agentRowActivity(unreadBusy, server, 'Researcher', read(10))).toMatchObject({
      tone: 'agent',
      unread: true,
      short: 'New reply',
    })
    expect(agentRowActivity(unreadBusy, server, 'Researcher', read(80))).toMatchObject({
      tone: 'busy',
      unread: false,
      short: 'Running a tool',
      label: 'Researcher is running a tool',
    })
    const idle = {...unreadBusy, busy: false}
    expect(agentRowActivity(idle, server, 'Researcher', read(80))).toBeNull()
    expect(agentRowActivity(undefined, server, 'Researcher', read(80))).toBeNull()
  })

  test('the newest event time of a transcript is what a view marks as read', () => {
    expect(latestSessionEventAt(undefined)).toBeUndefined()
    expect(latestSessionEventAt([{createdAt: 3}, {createdAt: 9}, {createdAt: 5}, {}])).toBe(9)
  })
})
