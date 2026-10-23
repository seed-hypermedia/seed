import {afterEach, describe, expect, test, vi} from 'vitest'
import {PlaygroundSession} from '../playground/session'
import {syncConcepts, conceptURL, eventConcept} from '../playground/static/sync-concepts.mjs'
import {createSyncView} from '../playground/static/sync.mjs'

function setupView() {
  const session = new PlaygroundSession()
  session.dispatch({type: 'loadScenario', id: 'sync-sharing'})
  const root = document.createElement('div')
  document.body.append(root)
  const inspect = vi.fn()
  const toast = vi.fn()
  let view: ReturnType<typeof createSyncView>
  view = createSyncView({
    root,
    snapshot: () => session.snapshot(),
    api: async (body: unknown) => ({ok: true, ...session.dispatch(body)}),
    render: () => view.render(),
    afterAction: () => view.render(),
    inspect,
    toast,
  })
  view.render()
  const click = async (action: string) => {
    const button = root.querySelector<HTMLButtonElement>(`[data-sync-action="${action}"]`)!
    button.click()
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>('[data-sync-action="build"]')!.disabled).toBe(false),
    )
  }
  return {root, session, click, inspect, toast, render: () => view.render()}
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('integrated sync workbench', () => {
  test('builds, steps repeatedly, lights graph and SQL, rewinds, and opens the shared world editor', async () => {
    const {root, session, click, inspect} = setupView()
    await click('build')
    expect(root.querySelectorAll('.sync-peer')).toHaveLength(2)
    for (let n = 1; n <= 16; n++) {
      await click('next')
      expect(session.snapshot().syncLab!.cursor).toBe(n)
    }
    expect(root.querySelectorAll('.sync-node.lit').length).toBeGreaterThan(0)
    expect(root.querySelectorAll('.sync-table.lit').length).toBeGreaterThan(0)
    expect(root.textContent).toContain('Block verified and stored')
    const oldTables = session.snapshot().syncLab!.peers.map((p) => p.tables.blobs.length)
    await click('back')
    expect(session.snapshot().syncLab!.cursor).toBe(15)
    expect(session.snapshot().syncLab!.peers[1]!.tables.blobs.length).toBeLessThan(oldTables[1]!)
    await click('next')
    expect(session.snapshot().syncLab!.peers.map((p) => p.tables.blobs.length)).toEqual(oldTables)
    root.querySelector<HTMLButtonElement>('[data-sync-mode="authority"]')!.click()
    const resource = root.querySelector<SVGGElement>('.sync-node.resource')!
    resource.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await click('inspect')
    expect(inspect).toHaveBeenCalledWith({type: 'resource', id: 'lab'})
  })

  test('fixture names and bytes render as escaped text, not executable markup', async () => {
    const {root, session, click} = setupView()
    session.state.resources[0]!.name = '<img src=x onerror=alert(1)>'
    await click('build')
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>')
  })
  test('keeps equal positions across peers and steps, and separates permissions from content', async () => {
    const {root, click} = setupView()
    await click('build')
    root.querySelector<HTMLButtonElement>('[data-sync-mode="content"]')!.click()
    const positions = (peer: number) =>
      Object.fromEntries(
        Array.from(
          root.querySelectorAll<SVGGElement>('.sync-peer')[peer]!.querySelectorAll<SVGGElement>('[data-sync-blob]'),
        ).map((node) => [node.dataset.syncBlob, node.dataset.position]),
      )
    const initial = positions(0)
    expect(Object.keys(initial)).toHaveLength(8)
    expect(positions(1)).toEqual(initial)
    expect(root.querySelectorAll('.sync-node.grant')).toHaveLength(0)
    expect(root.querySelectorAll('.sync-peer')[1]!.querySelectorAll('.ghost')).toHaveLength(8)
    for (let n = 0; n < 16; n++) await click('next')
    expect(positions(0)).toEqual(initial)
    expect(positions(1)).toEqual(initial)
    expect(root.querySelectorAll('.sync-peer')[1]!.querySelectorAll('.stored')).toHaveLength(2)
    expect(root.querySelectorAll('.sync-peer')[1]!.querySelectorAll('.pending')).toHaveLength(2)
    root.querySelector<HTMLButtonElement>('[data-sync-mode="authority"]')!.click()
    expect(root.querySelectorAll('.sync-node.grant').length).toBeGreaterThan(0)
    expect(root.querySelectorAll('.sync-node.manifest, .sync-edge.contains')).toHaveLength(0)
    expect(root.querySelectorAll('.sync-edge.proof').length).toBeGreaterThan(0)
  })

  test('teaches layers, exposes direct concept links, and does not draw private outlines for Bob', async () => {
    const {root, click} = setupView()
    await click('build')
    await click('lesson-next')
    expect(root.textContent).toContain('Compare the same position')
    await click('lesson-next')
    expect(root.querySelector('[data-sync-mode="authority"]')!.getAttribute('aria-pressed')).toBe('true')
    await click('lesson-next')
    expect(root.querySelector('[data-sync-mode="content"]')!.getAttribute('aria-pressed')).toBe('true')
    await click('lesson-next')
    expect(root.querySelector('.sync-lesson')).toBeNull()
    await click('learn')
    expect(root.querySelector('.sync-lesson')).not.toBeNull()
    const manifest = root.querySelector<SVGGElement>('.sync-node.manifest')!
    manifest.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    expect(root.querySelector('.sync-blob-detail')!.textContent).toContain('listing the addresses of its children')
    expect(root.querySelector('.sync-blob-detail a')!.getAttribute('href')).toBe(conceptURL('manifest'))
    expect(root.querySelectorAll('svg a[data-concept="manifest"]')).toHaveLength(6)
    for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-concept]'))) {
      expect(link.getAttribute('href')).toBe(conceptURL(link.dataset.concept!))
    }
    const resource = root.querySelector<HTMLSelectElement>('#sync-resource')!
    resource.value = 'private'
    resource.dispatchEvent(new Event('change'))
    expect(root.querySelectorAll('.sync-peer')[0]!.querySelectorAll('.sync-node').length).toBeGreaterThan(0)
    expect(root.querySelectorAll('.sync-peer')[1]!.querySelectorAll('.sync-node')).toHaveLength(0)
    expect(root.querySelector('.sync-blob-detail')).toBeNull()
  })

  test('follows active resource/layer changes and links every recorded RPC and local operation', async () => {
    const {root, session, click, render} = setupView()
    await click('build')
    const rendered = new Set<string>()
    for (let n = 0; n < 200 && !session.snapshot().syncLab!.done; n++) {
      session.dispatch({type: 'syncLabStep'})
      const lab = session.snapshot().syncLab!
      const payload = lab.event.payload as {resource?: string} | undefined
      const phase = `${lab.event.title}:${payload?.resource || ''}`
      expect(Object.keys(syncConcepts)).toContain(eventConcept(lab.event))
      if (rendered.has(phase)) continue
      rendered.add(phase)
      render()
      const explanation = root.querySelector('.sync-current a')!
      expect(explanation.getAttribute('href')).toBe(conceptURL(eventConcept(lab.event)))
      if (lab.event.active.length) expect(root.querySelectorAll('.sync-node.lit').length).toBeGreaterThan(0)
    }
    const lab = session.snapshot().syncLab!
    render()
    expect(lab.done).toBe(true)
    expect(root.querySelectorAll('.sync-trace-row > a')).toHaveLength(lab.trace.length)
    for (const key of Object.keys(lab.schemas)) {
      root.querySelector<HTMLButtonElement>(`[data-sync-table="${key}"]`)!.click()
      expect(root.querySelector('.sync-table-explanation a')!.getAttribute('href')).toBe(
        conceptURL(key === 'complete' ? 'complete_table' : key),
      )
    }
    expect(new Set(Object.values(syncConcepts).map((c) => c.block)).size).toBe(Object.keys(syncConcepts).length)
    expect(root.querySelector<HTMLSelectElement>('#sync-resource')!.value).toBe('notes')
  })
})
