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

  it('shows a message send time even when the event carries no stamp at all', () => {
    const rows = eventMetaRows(undefined, {sentAt: 1_700_000_000_000})
    expect(rows).toEqual([{label: 'Time', value: formatEventTime(1_700_000_000_000)}])
  })

  it('still renders nothing when neither stamp nor times exist', () => {
    expect(eventMetaRows(undefined, undefined)).toEqual([])
  })
})
