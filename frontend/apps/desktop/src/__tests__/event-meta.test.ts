import {describe, expect, it} from 'vitest'
import {eventMetaRows, formatEventTime} from '@shm/ui/agents/event-meta'

describe('eventMetaRows', () => {
  it('renders absolute times alongside the stamped stats, in reading order', () => {
    const rows = eventMetaRows(
      {model: 'gpt-5-mini', provider: 'openai', durationMs: 950},
      {startedAt: 1_700_000_000_000, completedAt: 1_700_000_000_950},
    )
    expect(rows.map((row) => row.label)).toEqual(['Model', 'Provider', 'Started', 'Finished', 'Duration'])
    expect(rows.find((row) => row.label === 'Started')?.value).toBe(formatEventTime(1_700_000_000_000))
  })

  it("names the reasoning level beside the model, in the picker's own words", () => {
    const rows = eventMetaRows({model: 'gpt-5.2', provider: 'openai', reasoningLevel: 'xhigh'})
    expect(rows.map((row) => row.label)).toEqual(['Model', 'Provider', 'Reasoning'])
    expect(rows.find((row) => row.label === 'Reasoning')?.value).toBe('X-High')
    expect(
      eventMetaRows({model: 'gpt-4o', reasoningLevel: 'off'}).find((row) => row.label === 'Reasoning')?.value,
    ).toBe('Off')
    expect(
      eventMetaRows({model: 'o3', reasoningLevel: 'default'}).find((row) => row.label === 'Reasoning')?.value,
    ).toBe('Provider default')
  })

  it('shows no reasoning row for an event stamped before the level was recorded', () => {
    expect(eventMetaRows({model: 'gpt-5-mini', provider: 'openai'}).map((row) => row.label)).toEqual([
      'Model',
      'Provider',
    ])
  })

  it('reads the provider turn timing off the stamp, after the wall-clock duration', () => {
    const rows = eventMetaRows({
      model: 'gpt-5.6-terra',
      provider: 'openai-codex',
      durationMs: 7,
      turn: {index: 3, ttftMs: 1193, turnMs: 2405},
    })
    expect(rows.map((row) => row.label)).toEqual(['Model', 'Provider', 'Turn', 'Duration', 'Model turn', 'First token'])
    expect(rows.find((row) => row.label === 'Turn')?.value).toBe('#3')
    expect(rows.find((row) => row.label === 'Model turn')?.value).toBe('2.4s')
    expect(rows.find((row) => row.label === 'First token')?.value).toBe('1.2s')
  })

  it('shows only the turn timing a partial stamp carries', () => {
    const rows = eventMetaRows({model: 'gpt-5-mini', turn: {turnMs: 61_000}})
    expect(rows.map((row) => row.label)).toEqual(['Model', 'Model turn'])
    expect(rows[1]?.value).toBe('1m 1s')
  })

  it('shows a message send time even when the event carries no stamp at all', () => {
    const rows = eventMetaRows(undefined, {sentAt: 1_700_000_000_000})
    expect(rows).toEqual([{label: 'Time', value: formatEventTime(1_700_000_000_000)}])
  })

  it('still renders nothing when neither stamp nor times exist', () => {
    expect(eventMetaRows(undefined, undefined)).toEqual([])
  })
})
