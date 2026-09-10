import {mkdtemp, rm, readdir, readFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

let directory: string
let drafts: typeof import('../app-drafts')
vi.mock('../app-paths', () => ({
  get userDataPath() {
    return directory
  },
}))
vi.mock('../app-invalidation', () => ({appInvalidateQueries: vi.fn()}))
vi.mock('../grpc-client', () => ({grpcClient: {}}))

beforeEach(async () => {
  vi.resetModules()
  directory = await mkdtemp(join(tmpdir(), 'seed-draft-cas-'))
  drafts = await import('../app-drafts')
  await drafts.initDrafts()
})
afterEach(async () => {
  await rm(directory, {recursive: true, force: true})
})

const initial = {
  id: 'draft12345',
  editUid: 'account',
  editPath: ['parent'],
  metadata: {name: 'Parent'},
  content: [],
  deps: ['v1'],
  visibility: 'PUBLIC' as const,
}

it('CAS rejects a concurrent edit without losing the new content', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  await api.write({...initial, metadata: {name: 'Unsaved title'}})
  expect(await drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']})).toBe(false)
  expect((await api.get(initial.id))?.metadata.name).toBe('Unsaved title')
})

it('rejects stale autosave after maintenance but allows an intentional later rebase', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  expect(await drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']})).toBe(true)
  await expect(api.write({...initial, metadata: {name: 'Stale'}})).rejects.toThrow('baseline')
  expect((await api.get(initial.id))?.deps).toEqual(['v2'])
  await api.write({...initial, deps: ['v3'], maintenanceRevision: 1})
  await expect(api.write(initial)).rejects.toThrow('baseline')
})

it('serializes two maintenance attempts against the same snapshot', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  const results = await Promise.all([
    drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']}),
    drafts.compareAndSwapDraft(expected, {...expected, deps: ['v3']}),
  ])
  expect(results).toEqual([true, false])
})

it('keeps obsolete baseline protection after restarting the store', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  await drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']})
  await drafts.initDrafts()
  await expect(api.write(initial)).rejects.toThrow('baseline')
})

it('does not resurrect a deleted draft during maintenance', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  await api.delete(initial.id)
  expect(await drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']})).toBe(false)
  expect(await api.get(initial.id)).toBeNull()
})

it('preserves rejected stale autosave content and metadata in history without replacing the corrected draft', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  await drafts.compareAndSwapDraft(expected, {...expected, deps: ['v2']})
  const attempted = {
    ...initial,
    metadata: {name: 'Unsaved title'},
    content: [
      {
        id: 'new-paragraph',
        type: 'paragraph',
        content: [{type: 'text', text: 'Unsaved text', styles: {}}],
        props: {},
        children: [],
      },
    ],
  }
  await expect(api.write(attempted)).rejects.toThrow('baseline')
  const history = join(directory, 'drafts', '.history')
  const names = await readdir(history)
  const rejected = names.filter((name) => name.includes('rejected-baseline'))
  expect(rejected).toHaveLength(1)
  const backup = JSON.parse(await readFile(join(history, rejected[0]!), 'utf-8'))
  expect(backup).toMatchObject({metadata: attempted.metadata, content: attempted.content, deps: ['v1']})
  expect(await api.get(initial.id)).toMatchObject({metadata: initial.metadata, content: [], deps: ['v2']})
})

it('rejects stale content after maintenance even when the published heads did not change', async () => {
  const api = drafts.draftsApi.createCaller({})
  await api.write(initial)
  const expected = (await api.get(initial.id))!
  await drafts.compareAndSwapDraft(expected, {...expected, metadata: {name: 'Corrected'}})
  await expect(api.write({...initial, metadata: {name: 'Stale editor'}})).rejects.toThrow('baseline')
  expect(await api.get(initial.id)).toMatchObject({metadata: {name: 'Corrected'}, maintenanceRevision: 1})
})
