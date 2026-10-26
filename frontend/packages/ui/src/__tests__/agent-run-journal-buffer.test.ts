// @vitest-environment jsdom
import {describe, expect, it} from 'vitest'
import type {RunJournalEntryInfo} from '../agents/client'
import {appendRunJournalEntry, RUN_JOURNAL_BUFFER_LIMIT} from '../agents/models'

function entry(runId: string, seq: number): RunJournalEntryInfo {
  return {runId, seq, entry: {kind: 'call', op: 'tool', callSeq: seq}, createdAt: seq}
}

/** Replays `count` entries of `runId` onto `journal`, the way the socket delivers one run's journal. */
function replay(journal: RunJournalEntryInfo[], runId: string, count: number, limit?: number): RunJournalEntryInfo[] {
  for (let seq = 1; seq <= count; seq += 1) journal = appendRunJournalEntry(journal, entry(runId, seq), limit)
  return journal
}

describe('appendRunJournalEntry', () => {
  it('keeps an early run’s journal when later siblings replay more entries than the whole-tree limit', () => {
    // The prod shape behind the empty run page: a child script with 186 entries, created second,
    // followed by siblings that together journal ~1,300 more. A tree-wide tail of 500 evicted the
    // child's entire journal; the bound is per run, so each run keeps its own tail.
    let journal: RunJournalEntryInfo[] = []
    journal = replay(journal, 'root', 0)
    journal = replay(journal, 'child-a', 186)
    journal = replay(journal, 'child-b', 186)
    journal = replay(journal, 'child-c', 370)
    journal = replay(journal, 'child-d', 400)
    journal = replay(journal, 'child-e', 400)
    expect(journal.filter((item) => item.runId === 'child-a')).toHaveLength(186)
    expect(journal.filter((item) => item.runId === 'child-e')).toHaveLength(400)
    expect(journal.length).toBe(186 + 186 + 370 + 400 + 400)
  })

  it('bounds each run to the limit by dropping that run’s oldest entries only', () => {
    let journal = replay([], 'sibling', 3, 4)
    journal = replay(journal, 'busy', 6, 4)
    expect(journal.filter((item) => item.runId === 'busy').map((item) => item.seq)).toEqual([3, 4, 5, 6])
    expect(journal.filter((item) => item.runId === 'sibling').map((item) => item.seq)).toEqual([1, 2, 3])
    // Arrival order is preserved: the evicted run's survivors still precede the newcomer.
    expect(journal.at(-1)).toMatchObject({runId: 'busy', seq: 6})
  })

  it('drops a duplicate (runId, seq) and returns the same array so React skips the update', () => {
    const journal = replay([], 'a', 2)
    expect(appendRunJournalEntry(journal, entry('a', 2))).toBe(journal)
    // seq is per run, so the same seq on another run is a different entry.
    expect(appendRunJournalEntry(journal, entry('b', 2))).toHaveLength(3)
  })

  it('defaults to the shared buffer limit', () => {
    const journal = replay([], 'a', RUN_JOURNAL_BUFFER_LIMIT + 5)
    expect(journal).toHaveLength(RUN_JOURNAL_BUFFER_LIMIT)
    expect(journal[0]!.seq).toBe(6)
  })
})
