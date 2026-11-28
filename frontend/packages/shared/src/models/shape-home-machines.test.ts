import {describe, expect, it} from 'vitest'
import {createActor, waitFor} from 'xstate'
import {hmId} from '../utils/entity-id-url'
import type {ShapeHomeCandidate} from '../utils/shape-home'
import {
  createShapeHomeAnnouncementMachine,
  createShapeHomeHelperMachine,
  shapeHomeJobEventFromSnapshot,
} from './shape-home-machines'
import type {DocumentCardCleanupJob} from './document-card-cleanup-machine'

const candidates: ShapeHomeCandidate[] = [
  {id: hmId('alice', {path: ['about']}), title: 'About'},
  {id: hmId('alice', {path: ['projects']}), title: 'Projects'},
  {id: hmId('alice', {path: ['blog']}), title: 'Blog'},
]

describe('shapeHomeJobEventFromSnapshot', () => {
  it('maps done to job.done with results', () => {
    const job = {state: 'done', addedTargetIds: ['a'], skippedTargetIds: ['b']} as DocumentCardCleanupJob
    expect(shapeHomeJobEventFromSnapshot(job)).toEqual({type: 'job.done', added: ['a'], skipped: ['b']})
  })
  it('maps failedNeedsAttention to job.failed', () => {
    const job = {state: 'failedNeedsAttention', lastError: 'boom'} as DocumentCardCleanupJob
    expect(shapeHomeJobEventFromSnapshot(job)).toEqual({type: 'job.failed', error: 'boom'})
  })
  it('maps skippedTerminal to job.failed', () => {
    const job = {state: 'skippedTerminal'} as DocumentCardCleanupJob
    expect(shapeHomeJobEventFromSnapshot(job)).toEqual({type: 'job.failed', error: 'Cleanup job failed'})
  })
  it('returns null for in-flight states', () => {
    expect(shapeHomeJobEventFromSnapshot({state: 'idle'} as DocumentCardCleanupJob)).toBeNull()
  })
})

describe('shapeHomeAnnouncementMachine', () => {
  function actor(effects: any, modalDone = false) {
    return createActor(createShapeHomeAnnouncementMachine(effects), {input: {modalDone}})
  }

  it('skips when modalDone is true', () => {
    const a = actor({}, true)
    a.start()
    a.send({type: 'app.ready'})
    expect(a.getSnapshot().value).toBe('skipped')
    a.stop()
  })

  it('happy path: checks, presents, shapes home', async () => {
    const actions: string[] = []
    const a = actor({
      findTarget: async () => ({uid: 'alice', candidates}),
      openSurface: (uid: string) => actions.push(`openSurface:${uid}`),
      showModal: () => actions.push('showModal'),
      closeModal: () => actions.push('closeModal'),
      persistModalDone: () => actions.push('persistModalDone'),
      navigateHome: (uid: string) => actions.push(`navigateHome:${uid}`),
    })
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.matches('presenting') && (s.value as any).presenting === 'opening')
    expect(actions).toEqual(['openSurface:alice'])
    a.send({type: 'surface.ready'})
    expect(a.getSnapshot().matches('presenting') && (a.getSnapshot().value as any).presenting === 'open').toBe(true)
    expect(actions).toContain('showModal')
    a.send({type: 'modal.shapeHome'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('handedOff')
    expect(actions).toContain('closeModal')
    expect(actions).toContain('persistModalDone')
    expect(actions).toContain('navigateHome:alice')
    a.stop()
  })

  it('notNow → declined and dismisses site', async () => {
    const actions: string[] = []
    const a = actor({
      findTarget: async () => ({uid: 'alice', candidates}),
      dismissSite: (uid: string) => actions.push(`dismissSite:${uid}`),
      persistModalDone: () => actions.push('persistModalDone'),
      closeModal: () => actions.push('closeModal'),
    })
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.matches('presenting') && (s.value as any).presenting === 'opening')
    a.send({type: 'surface.ready'})
    a.send({type: 'modal.notNow'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('declined')
    expect(actions).toContain('dismissSite:alice')
    expect(actions).toContain('persistModalDone')
    a.stop()
  })

  it('quit while modal open (surface.closed) → nothingToShow, nothing persisted', async () => {
    const actions: string[] = []
    const a = actor({
      findTarget: async () => ({uid: 'alice', candidates}),
      persistModalDone: () => actions.push('persistModalDone'),
      dismissSite: () => actions.push('dismissSite'),
    })
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.matches('presenting') && (s.value as any).presenting === 'opening')
    a.send({type: 'surface.closed'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('nothingToShow')
    expect(actions).toEqual([])
    a.stop()
  })

  it('already-organized (findTarget null) → nothingToShow', async () => {
    const a = actor({findTarget: async () => null})
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('nothingToShow')
    a.stop()
  })

  it('post-cutoff (findTarget error) → nothingToShow', async () => {
    const a = actor({
      findTarget: async () => {
        throw new Error('ineligible')
      },
    })
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('nothingToShow')
    a.stop()
  })

  it('modal.learnMore does not change state', async () => {
    const actions: string[] = []
    const a = actor({
      findTarget: async () => ({uid: 'alice', candidates}),
      openLearnMore: () => actions.push('openLearnMore'),
    })
    a.start()
    a.send({type: 'app.ready'})
    await waitFor(a, (s) => s.matches('presenting') && (s.value as any).presenting === 'opening')
    a.send({type: 'surface.ready'})
    a.send({type: 'modal.learnMore'})
    expect(a.getSnapshot().matches('presenting') && (a.getSnapshot().value as any).presenting === 'open').toBe(true)
    expect(actions).toContain('openLearnMore')
    a.stop()
  })
})

describe('shapeHomeHelperMachine', () => {
  function actor(effects: any, input: any = {uid: 'alice'}) {
    return createActor(createShapeHomeHelperMachine(effects), {input})
  }

  it('happy path with one deselected: loads, selects, enqueues, finishes', async () => {
    const actions: string[] = []
    const a = actor({
      loadCandidates: async () => candidates,
      enqueueAddCards: async (uid: string, targetIds: string[]) => {
        actions.push(`enqueue:${uid}:${targetIds.join(',')}`)
        return {jobId: 'job-1'}
      },
      persistRecord: (uid: string, record: any) => actions.push(`persist:${uid}:${record.status}`),
      refreshHome: (uid: string) => actions.push(`refresh:${uid}`),
      toastResult: (added: string[], skipped: string[]) => actions.push(`toast:${added.length}:${skipped.length}`),
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    expect(a.getSnapshot().context.selectedIds.size).toBe(3)
    a.send({type: 'toggle', id: hmId('alice', {path: ['blog']}).id})
    expect(a.getSnapshot().context.selectedIds.size).toBe(2)
    a.send({type: 'add'})
    await waitFor(a, (s) => s.value === 'waitingForJob')
    expect(actions).toContain('persist:alice:adding')
    a.send({type: 'job.done', added: ['about', 'projects'], skipped: []})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('finished')
    expect(actions).toContain('persist:alice:shaped')
    expect(actions).toContain('refresh:alice')
    expect(actions).toContain('toast:2:0')
    a.stop()
  })

  it('record adding on mount → waitingForJob', async () => {
    const a = actor({}, {uid: 'alice', record: {status: 'adding', jobId: 'job-x'}})
    a.start()
    expect(a.getSnapshot().value).toBe('waitingForJob')
    expect(a.getSnapshot().context.jobId).toBe('job-x')
    a.stop()
  })

  it('record shaped on mount → hidden final', () => {
    const a = actor({}, {uid: 'alice', record: {status: 'shaped'}})
    a.start()
    expect(a.getSnapshot().value).toBe('hidden')
    expect(a.getSnapshot().status).toBe('done')
    a.stop()
  })

  it('record dismissed on mount → hidden final', () => {
    const a = actor({}, {uid: 'alice', record: {status: 'dismissed'}})
    a.start()
    expect(a.getSnapshot().value).toBe('hidden')
    a.stop()
  })

  it('0 candidates → hidden final with persist shaped', async () => {
    const actions: string[] = []
    const a = actor({
      loadCandidates: async () => [],
      persistRecord: (uid: string, record: any) => actions.push(`persist:${uid}:${record.status}`),
    })
    a.start()
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('hidden')
    expect(actions).toContain('persist:alice:shaped')
    a.stop()
  })

  it('load error → loadFailed; retry → loading', async () => {
    let calls = 0
    const a = actor({
      loadCandidates: async () => {
        calls++
        if (calls === 1) throw new Error('offline')
        return candidates
      },
    })
    a.start()
    await waitFor(a, (s) => s.value === 'loadFailed')
    a.send({type: 'retry'})
    await waitFor(a, (s) => s.value === 'choosing')
    a.stop()
  })

  it('loadFailed notNow → dismissed with persist dismissed', async () => {
    const actions: string[] = []
    const a = actor({
      loadCandidates: async () => {
        throw new Error('offline')
      },
      persistRecord: (uid: string, record: any) => actions.push(`persist:${uid}:${record.status}`),
    })
    a.start()
    await waitFor(a, (s) => s.value === 'loadFailed')
    a.send({type: 'notNow'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('dismissed')
    expect(actions).toContain('persist:alice:dismissed')
    a.stop()
  })

  it('addFailed notNow → dismissed with persist dismissed', async () => {
    const actions: string[] = []
    const a = actor({
      loadCandidates: async () => candidates,
      enqueueAddCards: async () => {
        throw new Error('publish failed')
      },
      persistRecord: (uid: string, record: any) => actions.push(`persist:${uid}:${record.status}`),
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    a.send({type: 'add'})
    await waitFor(a, (s) => s.value === 'addFailed')
    a.send({type: 'notNow'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('dismissed')
    expect(actions).toContain('persist:alice:dismissed')
    a.stop()
  })

  it('notNow from choosing → dismissed with persist dismissed', async () => {
    const actions: string[] = []
    const a = actor({
      loadCandidates: async () => candidates,
      persistRecord: (uid: string, record: any) => actions.push(`persist:${uid}:${record.status}`),
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    a.send({type: 'notNow'})
    await waitFor(a, (s) => s.status === 'done')
    expect(a.getSnapshot().value).toBe('dismissed')
    expect(actions).toContain('persist:alice:dismissed')
    a.stop()
  })

  it('enqueue fails → addFailed; retry → retrying → waitingForJob', async () => {
    let calls = 0
    const a = actor({
      loadCandidates: async () => candidates,
      enqueueAddCards: async () => {
        calls++
        if (calls === 1) throw new Error('publish failed')
        return {jobId: 'job-2'}
      },
      retryJob: async () => {},
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    a.send({type: 'add'})
    await waitFor(a, (s) => s.value === 'addFailed')
    a.send({type: 'retry'})
    await waitFor(a, (s) => s.value === 'waitingForJob')
    a.stop()
  })

  it('job.failed → addFailed', async () => {
    const a = actor({
      loadCandidates: async () => candidates,
      enqueueAddCards: async () => ({jobId: 'job-3'}),
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    a.send({type: 'add'})
    await waitFor(a, (s) => s.value === 'waitingForJob')
    a.send({type: 'job.failed', error: 'publish failed'})
    await waitFor(a, (s) => s.value === 'addFailed')
    expect(a.getSnapshot().context.error).toBe('publish failed')
    a.stop()
  })

  it('resumed in choosing → loading with intersected selection', async () => {
    const a = actor({
      loadCandidates: async () => candidates,
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    // Deselect all but 'about'
    a.send({type: 'toggle', id: hmId('alice', {path: ['projects']}).id})
    a.send({type: 'toggle', id: hmId('alice', {path: ['blog']}).id})
    expect(a.getSnapshot().context.selectedIds.size).toBe(1)
    a.send({type: 'resumed'})
    await waitFor(a, (s) => s.value === 'choosing')
    // Intersection keeps 'about' selected
    expect(a.getSnapshot().context.selectedIds.has(hmId('alice', {path: ['about']}).id)).toBe(true)
    a.stop()
  })

  it('resumed with empty intersection selects all', async () => {
    const a = actor({
      loadCandidates: async () => candidates,
    })
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    // Set selection to a doc not in fresh candidates
    a.getSnapshot().context.selectedIds = new Set(['hm://alice/nonexistent'])
    a.send({type: 'resumed'})
    await waitFor(a, (s) => s.value === 'choosing')
    expect(a.getSnapshot().context.selectedIds.size).toBe(3)
    a.stop()
  })

  it('showMore toggles showAll', async () => {
    const a = actor({loadCandidates: async () => candidates})
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    expect(a.getSnapshot().context.showAll).toBe(false)
    a.send({type: 'showMore'})
    expect(a.getSnapshot().context.showAll).toBe(true)
    a.stop()
  })

  it('add with no selection is guarded (stays in choosing)', async () => {
    const a = actor({loadCandidates: async () => candidates})
    a.start()
    await waitFor(a, (s) => s.value === 'choosing')
    a.send({type: 'toggle', id: hmId('alice', {path: ['about']}).id})
    a.send({type: 'toggle', id: hmId('alice', {path: ['projects']}).id})
    a.send({type: 'toggle', id: hmId('alice', {path: ['blog']}).id})
    expect(a.getSnapshot().context.selectedIds.size).toBe(0)
    a.send({type: 'add'})
    expect(a.getSnapshot().value).toBe('choosing')
    a.stop()
  })
})
