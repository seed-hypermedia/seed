import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'
import {APP_INSTALL_TYPE, APP_TOOL_TYPE, APP_TYPE} from '../agents/apps'
import {APP_SLUG_PATTERN, appPagePlan, appSlugFromName, prepareAppPages} from '../agents/create-app-dialog'

vi.mock('../agents/mount', () => ({
  signDocumentAttributes: vi.fn(async ({to, attrs}: {to: {id: string}; attrs: unknown}) => ({
    id: to.id,
    blobs: [{cid: `cid-of-${to.id}`, data: new Uint8Array(), attrs}],
  })),
}))

describe('New → App', () => {
  it('derives a slug the environment accepts from the name, and leaves the rest to the person', () => {
    expect(appSlugFromName('Datalab Converter')).toBe('datalab-converter')
    expect(appSlugFromName('A very long name that keeps going past the limit an app slug has')).toHaveLength(32)
    expect(APP_SLUG_PATTERN.test(appSlugFromName('Datalab Converter'))).toBe(true)
    expect(APP_SLUG_PATTERN.test('Not A Slug')).toBe(false)
    expect(APP_SLUG_PATTERN.test('-leading')).toBe(false)
  })

  it('plans the app page under the location and its typed tools folder beneath it', () => {
    const plan = appPagePlan(hmId('alice', {path: ['team']}), {
      name: 'Converter',
      slug: 'converter',
      summary: 'Converts.',
    })
    expect(plan.app.id.id).toBe('hm://alice/team/converter')
    expect(plan.tools.id.id).toBe('hm://alice/team/converter/tools')
    expect(plan.app.attrs).toEqual([
      {key: ['name'], value: 'Converter'},
      {key: ['summary'], value: 'Converts.'},
      {key: ['attributesSchema'], value: APP_TYPE},
      {key: ['slug'], value: 'converter'},
    ])
    expect(plan.tools.attrs).toContainEqual({key: ['childAttributesSchema'], value: APP_TOOL_TYPE})
    expect(APP_TYPE).toBe('hm://hyper.media/app')
    expect(APP_TOOL_TYPE).toBe('hm://hyper.media/app-tool')
    expect(APP_INSTALL_TYPE).toBe('hm://hyper.media/app-install')
  })

  it('signs the app page before its folder, so a failing parent stops the child', async () => {
    const plan = appPagePlan(hmId('alice'), {name: 'Converter', slug: 'converter', summary: 'Converts.'})
    const pages = await prepareAppPages({client: {} as never, accountUid: 'alice', plan})
    expect(pages.map((page) => page.id)).toEqual(['hm://alice/converter', 'hm://alice/converter/tools'])
    expect(pages.flatMap((page) => page.blobs.map((blob) => blob.cid))).toEqual([
      'cid-of-hm://alice/converter',
      'cid-of-hm://alice/converter/tools',
    ])
  })
})
