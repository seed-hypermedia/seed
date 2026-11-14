import {describe, expect, test} from 'bun:test'
import {unpackHmId} from '@seed-hypermedia/client'
import {resolveAppParent, withHostLock} from '@/app-children'

function clientWith(types: Record<string, string>) {
  return {
    request: (async (_key: string, id: {id: string}) => {
      const type = types[id.id]
      return type ? {type: 'document', document: {metadata: {type}, content: []}} : {type: 'not-found', id}
    }) as never,
  }
}

describe('what lists a new document', () => {
  test('an app made under an agent is listed by the agent; under anything else it is not listed', async () => {
    const client = clientWith({'hm://z6Mks/helper': 'hm://hyper.media/agent', 'hm://z6Mks/notes': ''})
    const underAgent = await resolveAppParent(client, unpackHmId('hm://z6Mks/helper/writing')!, 'hm://hyper.media/app')
    expect(underAgent.app?.id.id).toBe('hm://z6Mks/helper')
    const elsewhere = await resolveAppParent(client, unpackHmId('hm://z6Mks/notes/writing')!, 'hm://hyper.media/app')
    expect(elsewhere.app).toBeNull()
  })
  test('a trigger outside an app or agent is refused', async () => {
    const client = clientWith({})
    const result = await resolveAppParent(client, unpackHmId('hm://z6Mks/notes/t')!, 'hm://hyper.media/trigger')
    expect(result.refusal).toContain('~/tools/write/triggers')
  })
})

describe('host lock', () => {
  test('writes under one host take turns; other hosts do not wait', async () => {
    const order: string[] = []
    const slow = (name: string, ms: number) => async () => {
      order.push(`${name} start`)
      await Bun.sleep(ms)
      order.push(`${name} end`)
    }
    await Promise.all([
      withHostLock('hm://z6Mks/app', slow('a', 30)),
      withHostLock('hm://z6Mks/app', slow('b', 1)),
      withHostLock('hm://z6Mks/other', slow('c', 1)),
    ])
    expect(order.indexOf('a end')).toBeLessThan(order.indexOf('b start'))
    expect(order.indexOf('c end')).toBeLessThan(order.indexOf('a end'))
  })
})
