import {describe, expect, it} from 'vitest'
import {createActor, waitFor} from 'xstate'
import {
  cleanupJobId,
  getCleanupJobParent,
  createDocumentCardCleanupCoordinatorMachine,
  nextDocumentCardCleanupDelayMs,
  normalizeDocumentCardCleanupStore,
  type DocumentCardCleanupJob,
  runCleanupJobWithMachine,
} from '../document-card-cleanup-machine'

function job(
  overrides: Partial<DocumentCardCleanupJob> & {
    parentDocumentId?: string
    sourceDocumentId?: string
    targetDocumentId?: string
  } = {},
): DocumentCardCleanupJob {
  return normalizeDocumentCardCleanupStore({
    jobs: [
      {
        id: 'remove-child',
        operation: 'remove',
        sourceDocumentId: 'hm://alice/parent/child',
        parentDocumentId: 'hm://alice/parent',
        signingAccountUid: 'alice',
        state: 'idle',
        attempts: 0,
        maxRetries: 3,
        createdAt: 1_000,
        updatedAt: 1_000,
        ...overrides,
      },
    ],
  }).jobs[0]!
}

function coordinator(
  jobs: DocumentCardCleanupJob[],
  now: () => number,
  overrides: Partial<Parameters<typeof createDocumentCardCleanupCoordinatorMachine>[0]> = {},
) {
  return createActor(
    createDocumentCardCleanupCoordinatorMachine({
      now,
      getParentDocumentId: () => null,
      scheduleCleanup: () => {},
      loadParentDraft: async () => null,
      loadParentDocument: async () => null,
      cleanupParentDraft: async () => [],
      planPublishedParent: () => ({changes: [], removedBlockIds: []}),
      publishParentUpdate: async () => 'published',
      invalidateParent: () => {},
      ...overrides,
    }),
    {input: {jobs, now: now()}},
  )
}

describe('document card cleanup queue recovery', () => {
  it('keeps operations on the same parent ordered while allowing a retry to wait', () => {
    const jobs = [job({state: 'retryScheduled', nextRunAt: 5_000}), job({id: 'same-parent'})]
    expect(nextDocumentCardCleanupDelayMs(jobs, 1_000)).toBe(4_000)
    const actor = coordinator(jobs, () => 1_000)
    actor.start()
    try {
      actor.send({type: 'cleanup.tick'})
      expect(actor.getSnapshot().value).toBe('waitingForRetry')
    } finally {
      actor.stop()
    }
  })

  it('retains an unexpected actor crash as retryable work instead of stopping the coordinator', async () => {
    const actor = coordinator([job()], () => 1_000, {
      loadParentDocument: async () => ({version: 'base'}),
      planPublishedParent: () => {
        throw new Error('Unexpected planning error')
      },
    })
    actor.start()
    try {
      actor.send({type: 'cleanup.tick'})
      await waitFor(actor, (snapshot) => snapshot.value === 'idle')
      expect(actor.getSnapshot().status).toBe('active')
      expect(actor.getSnapshot().context.jobs[0]).toMatchObject({
        state: 'retryScheduled',
        attempts: 1,
        lastError: 'Unexpected planning error',
        nextRunAt: 2_000,
      })
    } finally {
      actor.stop()
    }
  })

  it('lets the coordinator spend three retries and retain the fourth failure for attention', async () => {
    let now = 1_000
    let reads = 0
    const actor = coordinator([job()], () => now, {
      loadParentDocument: async () => {
        reads++
        throw new Error('Storage unavailable')
      },
    })
    actor.start()
    try {
      for (let attempt = 1; attempt <= 4; attempt++) {
        actor.send({type: 'cleanup.tick'})
        await waitFor(actor, (snapshot) => snapshot.value === 'idle')
        const result = actor.getSnapshot().context.jobs[0]!
        expect(result.attempts).toBe(attempt)
        expect(result.state).toBe(attempt <= 3 ? 'retryScheduled' : 'failedNeedsAttention')
        now = result.nextRunAt ?? now
      }
      actor.send({type: 'cleanup.tick'})
      expect(reads).toBe(4)
    } finally {
      actor.stop()
    }
  })
  it('uses the current clock for timer ticks without an explicit timestamp', () => {
    let now = 1_000
    const actor = coordinator([job({state: 'retryScheduled', nextRunAt: 2_000, attempts: 1})], () => now)
    actor.start()
    try {
      actor.send({type: 'cleanup.tick'})
      expect(actor.getSnapshot().value).toBe('waitingForRetry')
      now = 2_000
      actor.send({type: 'cleanup.tick'})
      expect(actor.getSnapshot().value).toBe('running')
    } finally {
      actor.stop()
    }
  })

  it('does not let a delayed retry block unrelated ready work', () => {
    const jobs = [
      job({state: 'retryScheduled', nextRunAt: 5_000, attempts: 1}),
      job({id: 'another-parent', parentDocumentId: 'hm://alice/other'}),
    ]
    expect(nextDocumentCardCleanupDelayMs(jobs, 1_000)).toBe(0)
    const actor = coordinator(jobs, () => 1_000)
    actor.start()
    try {
      actor.send({type: 'cleanup.tick'})
      expect(actor.getSnapshot().context.activeJobId).toBe('another-parent')
    } finally {
      actor.stop()
    }
  })

  it.each(['loadingParent', 'updating', 'publishing', 'verifying'] as const)(
    'makes an interrupted %s job runnable after restart without spending a retry',
    (state) => {
      const restored = normalizeDocumentCardCleanupStore({
        coordinatorState: 'running',
        jobs: [job({state, attempts: 2})],
      })
      expect(restored.coordinatorState).toBe('idle')
      expect(restored.jobs[0]).toMatchObject({state: 'idle', attempts: 2})
    },
  )

  it('preserves exhausted failures and future retry deadlines during recovery', () => {
    const jobs = [
      job({state: 'failedNeedsAttention', attempts: 4, lastError: 'Cannot publish parent'}),
      job({id: 'retry', state: 'retryScheduled', attempts: 1, nextRunAt: 5_000}),
    ]
    expect(normalizeDocumentCardCleanupStore({coordinatorState: 'idle', jobs}).jobs).toEqual(jobs)
  })

  it('allows an attention item to be retried explicitly with a fresh retry allowance', () => {
    const actor = coordinator([job({state: 'failedNeedsAttention', attempts: 4, lastError: 'Offline'})], () => 2_000)
    actor.start()
    try {
      actor.send({type: 'cleanup.retry', jobId: 'remove-child'})
      expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'idle', attempts: 0})
      expect(actor.getSnapshot().context.jobs[0]?.lastError).toBeUndefined()
    } finally {
      actor.stop()
    }
  })

  it('dismisses only attention items, not queued or active work', () => {
    const actor = coordinator([job({state: 'failedNeedsAttention', attempts: 4}), job({id: 'queued'})], () => 2_000)
    actor.start()
    try {
      actor.send({type: 'cleanup.dismiss', jobId: 'queued'})
      expect(actor.getSnapshot().context.jobs).toHaveLength(2)
      actor.send({type: 'cleanup.dismiss', jobId: 'remove-child'})
      expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'dismissed', dismissedAt: 2_000, attempts: 4})
      expect(actor.getSnapshot().context.jobs[1]?.id).toBe('queued')
    } finally {
      actor.stop()
    }
  })
})

describe('published parent reconciliation checkpoints', () => {
  it('publishes and verifies before touching drafts, retaining the checkpoint after a draft failure', async () => {
    const calls: string[] = []
    let published = false
    const effects = {
      now: () => 1000,
      loadParentDraft: async () => null,
      cleanupParentDraft: async () => [],
      loadParentDocument: async () => {
        calls.push('read')
        return {version: published ? 'new' : 'base'}
      },
      planPublishedParent: () => ({changes: published ? [] : [{}], removedBlockIds: []}),
      publishParentUpdate: async () => {
        calls.push('publish')
        published = true
        return 'published' as const
      },
      reconcileParentDraft: async () => {
        calls.push('rebase')
        throw new Error('Draft changed')
      },
      invalidateParent: () => {},
    }
    const first = await runCleanupJobWithMachine(effects, job(), 1000)
    expect(first).toMatchObject({state: 'failed', publishedVersion: 'new'})
    expect(calls).toEqual(['read', 'publish', 'read', 'rebase'])
    calls.length = 0
    const next = await runCleanupJobWithMachine(
      {
        ...effects,
        reconcileParentDraft: async () => {
          calls.push('rebase')
        },
      },
      first,
      2000,
    )
    expect(next.state).toBe('done')
    expect(calls).toEqual(['read', 'rebase'])
  })
  it('does not mark an invisible publication successful or mutate drafts', async () => {
    let rebased = false
    const result = await runCleanupJobWithMachine(
      {
        now: () => 1000,
        loadParentDraft: async () => null,
        cleanupParentDraft: async () => [],
        loadParentDocument: async () => ({version: 'old'}),
        planPublishedParent: () => ({changes: [{}], removedBlockIds: []}),
        publishParentUpdate: async () => 'published',
        reconcileParentDraft: async () => {
          rebased = true
        },
        invalidateParent: () => {},
      },
      job(),
      1000,
    )
    expect(result.state).toBe('failed')
    expect(result.publishedVersion).toBeUndefined()
    expect(rebased).toBe(false)
  })
})

describe('primary intents and supersession', () => {
  it('keeps an add until the later removal is released, then skips its obsolete retry', () => {
    const add = job({
      id: 'add',
      operation: 'add',
      sourceDocumentId: undefined,
      targetDocumentId: 'hm://alice/parent/child',
      state: 'retryScheduled',
      nextRunAt: 5000,
    })
    const actor = coordinator([add], () => 1000)
    actor.start()
    actor.send({
      type: 'cleanup.enqueue',
      operation: 'remove',
      sourceDocumentId: 'hm://alice/parent/child',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
      awaitingPrimary: {documentId: 'hm://alice/parent/child', expectedType: 'tombstone'},
    })
    const removal = actor.getSnapshot().context.jobs[1]!
    expect(actor.getSnapshot().context.jobs[0]?.state).toBe('retryScheduled')
    expect(removal.state).toBe('awaitingPrimary')
    actor.send({type: 'cleanup.release', jobId: removal.id})
    expect(actor.getSnapshot().context.jobs[0]?.state).toBe('skippedTerminal')
    actor.stop()
  })
  it('retargets an uncompleted first-publication addition when the child is renamed', () => {
    const actor = coordinator(
      [job({id: 'add', operation: 'add', targetDocumentId: 'hm://alice/parent/child'})],
      () => 1000,
    )
    actor.start()
    actor.send({
      type: 'cleanup.enqueue',
      operation: 'rewrite',
      sourceDocumentId: 'hm://alice/parent/child',
      targetDocumentId: 'hm://alice/parent/renamed',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
    })
    expect(actor.getSnapshot().context.jobs[0]?.target?.id).toBe('hm://alice/parent/renamed')
    actor.stop()
  })
  it('surfaces an unprovable recovered primary without touching the parent', async () => {
    let parentReads = 0
    const actor = coordinator(
      [
        job({
          state: 'awaitingPrimary',
          awaitingPrimary: {documentId: 'hm://alice/parent/child', expectedType: 'document'},
        }),
      ],
      () => 1000,
      {
        verifyPrimaryOutcome: async () => {
          throw new Error('Cannot prove publication')
        },
        loadParentDocument: async () => {
          parentReads++
          return null
        },
      },
    )
    actor.start()
    actor.send({type: 'cleanup.tick'})
    await waitFor(actor, (snapshot) => snapshot.value === 'idle')
    expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'failedNeedsAttention', attempts: 0})
    expect(parentReads).toBe(0)
    actor.stop()
  })
  it('persists the verified publication checkpoint before a slow draft reconciliation finishes', async () => {
    let finish!: () => void
    let published = false
    const actor = coordinator([job()], () => 1000, {
      loadParentDocument: async () => ({version: published ? 'new' : 'old'}),
      planPublishedParent: () => ({changes: published ? [] : [{}], removedBlockIds: []}),
      publishParentUpdate: async () => {
        published = true
        return 'published'
      },
      reconcileParentDraft: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    })
    actor.start()
    actor.send({type: 'cleanup.tick'})
    await waitFor(actor, (snapshot) => snapshot.context.jobs[0]?.publishedVersion === 'new')
    expect(actor.getSnapshot().context.jobs[0]?.state).not.toBe('done')
    finish()
    await waitFor(actor, (snapshot) => snapshot.value === 'idle')
    expect(actor.getSnapshot().context.jobs[0]?.state).toBe('done')
    actor.stop()
  })
})

describe('structured cleanup identity migration', () => {
  it('migrates legacy hierarchical IDs without retaining redundant string aliases', () => {
    const migrated = normalizeDocumentCardCleanupStore({
      coordinatorState: 'idle',
      jobs: [
        {
          ...job(),
          source: undefined,
          sourceDocumentId: 'hm://alice/parent/child',
          parentDocumentId: 'hm://alice/parent',
        },
      ],
    })
    expect(migrated).toMatchObject({schemaVersion: 2})
    expect(migrated.jobs[0]).toMatchObject({source: {uid: 'alice', path: ['parent', 'child']}})
    expect(migrated.jobs[0]).not.toHaveProperty('parentDocumentId')
    expect(migrated.jobs[0]).not.toHaveProperty('sourceDocumentId')
    expect(migrated.jobs[0]).not.toHaveProperty('deletedDocumentId')
    expect(migrated.jobs[0]).not.toHaveProperty('container')
  })

  it('retains an explicit arbitrary container instead of inventing a parent relationship', () => {
    const migrated = normalizeDocumentCardCleanupStore({
      coordinatorState: 'idle',
      jobs: [
        {
          ...job(),
          source: undefined,
          sourceDocumentId: 'hm://alice/parent/child',
          parentDocumentId: 'hm://bob/collection',
        },
      ],
    })
    expect(migrated.jobs[0]).toMatchObject({container: {uid: 'bob', path: ['collection']}})
  })
})

it('preserves a live editor conflict when an in-flight attempt later succeeds', async () => {
  let complete!: () => void
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  const actor = coordinator([job()], () => 1000, {
    loadParentDocument: async () => ({version: 'v2'}),
    reconcileParentDraft: async () => pending,
  })
  actor.start()
  actor.send({type: 'cleanup.tick'})
  await waitFor(actor, (snapshot) => snapshot.context.jobs[0]?.state === 'updating')
  actor.send({type: 'cleanup.needsAttention', jobId: 'remove-child', error: 'Unsaved editor conflict'})
  complete()
  await waitFor(actor, (snapshot) => snapshot.value === 'idle')
  expect(actor.getSnapshot().context.jobs[0]).toMatchObject({
    state: 'failedNeedsAttention',
    lastError: 'Unsaved editor conflict',
  })
  actor.stop()
})

it('keeps separately authorized lifecycle intent IDs distinct despite identical document paths', () => {
  const input = {
    operation: 'add' as const,
    targetDocumentId: 'hm://alice/parent/child',
    parentDocumentId: 'hm://alice/parent',
    signingAccountUid: 'alice',
  }
  expect(cleanupJobId({...input, intentId: 'first-publish'})).not.toBe(
    cleanupJobId({...input, intentId: 'later-publish'}),
  )
})

it('derives add destination parent from the structured target rather than its original source', () => {
  const value = job({
    operation: 'add',
    sourceDocumentId: 'hm://alice/old/child',
    targetDocumentId: 'hm://alice/new/child',
    parentDocumentId: 'hm://alice/new',
  })
  expect(getCleanupJobParent(value).id).toBe('hm://alice/new')
  expect(value.container).toBeUndefined()
})

it('renews only an attention deletion job with the newly reviewed scope', () => {
  const actor = coordinator([job({operation: 'delete-child', state: 'failedNeedsAttention', attempts: 4})], () => 1000)
  actor.start()
  const approvedSubtree = [{id: 'hm://alice/parent/child', version: 'new-version'}]
  actor.send({type: 'cleanup.reconfirmDeletion', jobId: 'remove-child', approvedSubtree})
  expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'idle', attempts: 0, approvedSubtree})
  actor.stop()
})

it('does not apply deletion consent to a pending action or a nondeletion job', () => {
  for (const overrides of [
    {operation: 'delete-child' as const, state: 'idle' as const},
    {operation: 'add' as const, state: 'failedNeedsAttention' as const},
  ]) {
    const original = job(overrides)
    const actor = coordinator([original], () => 1000)
    actor.start()
    actor.send({
      type: 'cleanup.reconfirmDeletion',
      jobId: original.id,
      approvedSubtree: [{id: 'hm://alice/parent/child', version: 'new-version'}],
    })
    expect(actor.getSnapshot().context.jobs[0]).toEqual(original)
    actor.stop()
  }
})

describe('chained reference maintenance intents', () => {
  it('composes a failed A to B rewrite into A to C and clears its publication checkpoint', () => {
    const actor = coordinator(
      [
        job({
          operation: 'rewrite',
          sourceDocumentId: 'hm://alice/parent/a',
          targetDocumentId: 'hm://alice/parent/b',
          state: 'failedNeedsAttention',
          publishedVersion: 'old-checkpoint',
        }),
      ],
      () => 1000,
    )
    actor.start()
    actor.send({
      type: 'cleanup.enqueue',
      operation: 'rewrite',
      sourceDocumentId: 'hm://alice/parent/b',
      targetDocumentId: 'hm://alice/parent/c',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
    })
    const composed = actor.getSnapshot().context.jobs[0]!
    expect(composed).toMatchObject({
      operation: 'rewrite',
      state: 'idle',
      source: expect.objectContaining({id: 'hm://alice/parent/a'}),
      target: expect.objectContaining({id: 'hm://alice/parent/c'}),
    })
    expect(composed.publishedVersion).toBeUndefined()
    actor.stop()
  })

  it('turns a failed rename into Card-only removal at its original source when the renamed child is deleted', () => {
    const actor = coordinator(
      [
        job({
          operation: 'rewrite',
          sourceDocumentId: 'hm://alice/parent/a',
          targetDocumentId: 'hm://alice/parent/b',
          state: 'failedNeedsAttention',
          publishedVersion: 'old-checkpoint',
        }),
      ],
      () => 1000,
    )
    actor.start()
    actor.send({
      type: 'cleanup.enqueue',
      operation: 'remove',
      sourceDocumentId: 'hm://alice/parent/b',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
    })
    const obsolete = actor.getSnapshot().context.jobs[0]!
    expect(obsolete).toMatchObject({
      operation: 'remove',
      state: 'idle',
      source: expect.objectContaining({id: 'hm://alice/parent/a'}),
    })
    expect(obsolete.target).toBeUndefined()
    expect(obsolete.publishedVersion).toBeUndefined()
    actor.stop()
  })

  it('composes a later rename after an in-flight attempt fails without changing the active input', async () => {
    let reject!: (error: Error) => void
    const actor = coordinator(
      [job({operation: 'rewrite', sourceDocumentId: 'hm://alice/parent/a', targetDocumentId: 'hm://alice/parent/b'})],
      () => 1000,
      {
        loadParentDocument: () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise
          }),
      },
    )
    actor.start()
    actor.send({type: 'cleanup.tick'})
    actor.send({
      type: 'cleanup.enqueue',
      operation: 'rewrite',
      sourceDocumentId: 'hm://alice/parent/b',
      targetDocumentId: 'hm://alice/parent/c',
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
    })
    expect(actor.getSnapshot().context.jobs[0]?.target?.id).toBe('hm://alice/parent/b')
    reject(new Error('offline'))
    await waitFor(actor, (snapshot) => snapshot.value === 'idle')
    expect(actor.getSnapshot().context.jobs[0]).toMatchObject({
      state: 'idle',
      target: expect.objectContaining({id: 'hm://alice/parent/c'}),
    })
    actor.stop()
  })
})

describe('dismissed maintenance history', () => {
  it('persists audit details without scheduling dismissed jobs and clears only history', () => {
    const original = job({state: 'failedNeedsAttention', attempts: 4, lastError: 'Offline'})
    const actor = coordinator([original], () => 2_000)
    actor.start()
    actor.send({type: 'cleanup.dismiss', jobId: original.id})
    const saved = normalizeDocumentCardCleanupStore({jobs: actor.getSnapshot().context.jobs}).jobs
    expect(saved[0]).toMatchObject({...original, state: 'dismissed', dismissedAt: 2_000, updatedAt: 2_000})
    expect(nextDocumentCardCleanupDelayMs(saved, 3_000)).toBeNull()
    const restored = coordinator([...saved, job({id: 'attention', state: 'failedNeedsAttention'})], () => 3_000)
    restored.start()
    restored.send({type: 'cleanup.tick'})
    expect(restored.getSnapshot().value).toBe('idle')
    restored.send({type: 'cleanup.clearDismissed'})
    expect(restored.getSnapshot().context.jobs.map(({id}) => id)).toEqual(['attention'])
    restored.stop()
    actor.stop()
  })

  it.each(['remove', 'add', 'rewrite'] as const)(
    'allows a new %s action at the same path without losing dismissed history',
    (operation) => {
      const intent = {
        operation,
        sourceDocumentId: 'hm://alice/parent/child',
        targetDocumentId: 'hm://alice/parent/target',
        parentDocumentId: 'hm://alice/parent',
        signingAccountUid: 'alice',
      }
      const id = cleanupJobId(intent)
      const original = job({...intent, id, state: 'dismissed', dismissedAt: 1_000, attempts: 4, lastError: 'Offline'})
      const actor = coordinator([original], () => 2_000)
      actor.start()
      actor.send({
        type: 'cleanup.enqueue',
        ...intent,
        awaitingPrimary: {documentId: intent.sourceDocumentId, expectedType: 'tombstone'},
      })
      const jobs = actor.getSnapshot().context.jobs
      expect(jobs).toHaveLength(2)
      expect(jobs[0]).toMatchObject({...original, id: expect.any(String)})
      expect(jobs[0]?.id).not.toBe(id)
      expect(jobs[1]).toMatchObject({id, state: 'awaitingPrimary', attempts: 0})
      actor.send({type: 'cleanup.release', jobId: id})
      expect(actor.getSnapshot().context.jobs[0]?.state).toBe('dismissed')
      expect(actor.getSnapshot().context.jobs[1]?.state).toBe('idle')
      actor.stop()
    },
  )

  it('does not automatically revive a dismissed explicit primary intent on duplicate enqueue', () => {
    const original = job({id: 'primary-intent', state: 'dismissed', dismissedAt: 1_000})
    const actor = coordinator([original], () => 2_000)
    actor.start()
    actor.send({
      type: 'cleanup.enqueue',
      intentId: original.id,
      sourceDocumentId: original.source?.id,
      parentDocumentId: 'hm://alice/parent',
      signingAccountUid: 'alice',
    })
    expect(actor.getSnapshot().context.jobs).toEqual([original])
    actor.stop()
  })

  it('retains only the newest 500 dismissed jobs for 90 days, leaving unfinished work intact', () => {
    const day = 86_400_000
    let now = 100 * day
    const history = Array.from({length: 501}, (_, i) => job({id: String(i), state: 'dismissed', dismissedAt: now - i}))
    const actor = coordinator(
      [
        job({id: 'old', state: 'dismissed', dismissedAt: now - 91 * day}),
        ...history,
        job({id: 'attention', state: 'failedNeedsAttention'}),
      ],
      () => now,
    )
    actor.start()
    expect(actor.getSnapshot().context.jobs).toHaveLength(501)
    expect(actor.getSnapshot().context.jobs.some(({id}) => id === 'old' || id === '500')).toBe(false)
    now += 91 * day
    actor.send({type: 'cleanup.tick'})
    expect(actor.getSnapshot().context.jobs.map(({id}) => id)).toEqual(['attention'])
    actor.stop()
  })

  it('caps history on dismissal and ignores late release or attention events for dismissed work', () => {
    const actor = coordinator(
      [
        ...Array.from({length: 500}, (_, i) => job({id: String(i), state: 'dismissed', dismissedAt: 1_000 + i})),
        job({state: 'failedNeedsAttention'}),
      ],
      () => 2_000,
    )
    actor.start()
    actor.send({type: 'cleanup.dismiss', jobId: 'remove-child'})
    expect(actor.getSnapshot().context.jobs).toHaveLength(500)
    expect(actor.getSnapshot().context.jobs.some(({id}) => id === '0')).toBe(false)
    actor.send({type: 'cleanup.release', jobId: 'remove-child'})
    actor.send({type: 'cleanup.needsAttention', jobId: 'remove-child', error: 'Late error'})
    expect(actor.getSnapshot().context.jobs.find(({id}) => id === 'remove-child')?.state).toBe('dismissed')
    actor.stop()
  })

  it('does not dismiss or clear an in-flight job even when it is marked for attention', async () => {
    let complete!: () => void
    const pending = new Promise<void>((resolve) => {
      complete = resolve
    })
    const actor = coordinator([job()], () => 2_000, {
      loadParentDocument: async () => ({version: 'current'}),
      reconcileParentDraft: async () => pending,
    })
    actor.start()
    actor.send({type: 'cleanup.tick'})
    await waitFor(actor, (snapshot) => snapshot.context.jobs[0]?.state === 'updating')
    actor.send({type: 'cleanup.needsAttention', jobId: 'remove-child', error: 'Conflict'})
    actor.send({type: 'cleanup.dismiss', jobId: 'remove-child'})
    actor.send({type: 'cleanup.clearDismissed'})
    expect(actor.getSnapshot().context.jobs[0]?.state).toBe('failedNeedsAttention')
    complete()
    await waitFor(actor, (snapshot) => snapshot.value === 'idle')
    actor.stop()
  })

  it('freshly verifies primary outcome when retrying dismissed references', async () => {
    let verifications = 0
    const actor = coordinator(
      [
        job({
          state: 'dismissed',
          dismissedAt: 1_000,
          publishedVersion: 'old-checkpoint',
          primaryConfirmed: true,
          awaitingPrimary: {documentId: 'hm://alice/parent/child', expectedType: 'tombstone'},
        }),
      ],
      () => 2_000,
      {
        verifyPrimaryOutcome: async () => {
          verifications++
          throw new Error('Primary changed')
        },
      },
    )
    actor.start()
    actor.send({type: 'cleanup.retry', jobId: 'remove-child'})
    expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'idle', attempts: 0, primaryConfirmed: false})
    expect(actor.getSnapshot().context.jobs[0]?.dismissedAt).toBeUndefined()
    expect(actor.getSnapshot().context.jobs[0]?.publishedVersion).toBeUndefined()
    actor.send({type: 'cleanup.tick'})
    await waitFor(actor, (snapshot) => snapshot.value === 'idle')
    expect(verifications).toBe(1)
    actor.stop()
  })

  it.each(['dismissed', 'failedNeedsAttention'] as const)(
    'requires fresh deletion consent for %s jobs, never generic retry',
    (state) => {
      const original = job({operation: 'delete-child', state, dismissedAt: state === 'dismissed' ? 1_000 : undefined})
      const actor = coordinator([original], () => 2_000)
      actor.start()
      actor.send({type: 'cleanup.retry', jobId: original.id})
      expect(actor.getSnapshot().context.jobs[0]).toEqual(original)
      actor.send({type: 'cleanup.reconfirmDeletion', jobId: original.id})
      expect(actor.getSnapshot().context.jobs[0]).toEqual(original)
      const approvedSubtree = [{id: 'hm://alice/parent/child', version: 'current'}]
      actor.send({type: 'cleanup.reconfirmDeletion', jobId: original.id, approvedSubtree})
      expect(actor.getSnapshot().context.jobs[0]).toMatchObject({state: 'idle', approvedSubtree})
      expect(actor.getSnapshot().context.jobs[0]?.dismissedAt).toBeUndefined()
      actor.stop()
    },
  )
})
