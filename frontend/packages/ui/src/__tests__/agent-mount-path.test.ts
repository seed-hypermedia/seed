import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'
import {findFreeAgentMountPath} from '../agents/mount'

function clientWithTaken(taken: string[]) {
  return {
    request: vi.fn(async (_method: string, id: {id: string}) =>
      taken.includes(id.id) ? {type: 'document', id} : {type: 'not-found', id},
    ),
  } as never
}

describe('findFreeAgentMountPath', () => {
  const parent = hmId('alice', {path: ['notes']})

  it('slugs the agent name under the parent', async () => {
    const id = await findFreeAgentMountPath(clientWithTaken([]), parent, 'Amber Wolf')
    expect(id.id).toBe('hm://alice/notes/amber-wolf')
  })

  it('numbers the slug past existing documents and deleted ones are reusable', async () => {
    const client = clientWithTaken(['hm://alice/notes/amber-wolf', 'hm://alice/notes/amber-wolf-2'])
    const id = await findFreeAgentMountPath(client, parent, 'Amber Wolf')
    expect(id.id).toBe('hm://alice/notes/amber-wolf-3')
  })

  it('falls back to a generic slug for names with no path characters', async () => {
    const id = await findFreeAgentMountPath(clientWithTaken([]), hmId('alice'), '🤖')
    expect(id.id).toBe('hm://alice/agent')
  })
})
