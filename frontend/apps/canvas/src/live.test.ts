import {expect, it} from 'vitest'
import {clientFor, listSite, readDocument, readThreads, resolveSite} from './network'
import type {CanvasDocument} from './graph'

it.runIf(import.meta.env.SEED_CANVAS_LIVE === '1')(
  'reads the real test site, documents, conversations, and observed events',
  async () => {
    const site = await resolveSite('https://seedteamtalks.hyper.media')
    const documents: CanvasDocument[] = []
    const ids = await listSite(site, (batch) => documents.push(...batch))
    expect(ids.size).toBeGreaterThan(0)
    const target = documents.find((d) => d.path.join('/') === 'tasks') || documents[0]
    const document = await readDocument(target)
    expect(document.content?.length).toBeGreaterThan(0)
    const threads = await readThreads(document)
    const feed = await clientFor(site.origin).request('ListEvents', {
      pageSize: 2,
      order: 'observed',
      filterResource: `hm://${site.uid}*`,
    })
    expect(feed.events.length).toBeGreaterThan(0)
    console.log(
      JSON.stringify({
        site: site.title,
        documents: ids.size,
        sample: document.title,
        threads: threads.length,
        events: feed.events.length,
      }),
    )
  },
  120000,
)

it.runIf(import.meta.env.SEED_CANVAS_LIVE === '1')(
  'reads a real account profile without document content',
  async () => {
    const site = await resolveSite('https://seedteamtalks.hyper.media')
    const account = await readDocument({
      id: `hm://${site.uid}/:profile`,
      siteUid: site.uid,
      origin: site.origin,
      path: [],
      title: 'Seed account',
      version: '',
      external: false,
      commentCount: 0,
    })
    expect(account.resourceType).toBe('account')
    expect(account.title).not.toBe('Seed account')
    expect(account.error).toBeUndefined()
    expect(account.content).toEqual([])
  },
  45000,
)
