import {describe, expect, test} from 'bun:test'
import {unpackHmId} from '@seed-hypermedia/client'
import {resolveAppParent} from '@/app-children'

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
