import {queryClient} from '@/client'
import {ActionFunction, json} from '@remix-run/node'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {z} from 'zod'

const discoverSchema = z.object({
  uid: z.string(),
  path: z.array(z.string()),
  version: z.string().optional(),
})

export const action: ActionFunction = async ({request}) => {
  try {
    const data = await request.json()
    const input = discoverSchema.parse(data)
    console.log('[discover][start]: ', input)
    const discovered = await queryClient.entities.discoverEntity({
      account: input.uid,
      path: hmIdPathToEntityQueryPath(input.path),
      version: input.version,
      recursive: true,
    })
    console.log('[discover][end] version: ', discovered.version)
    return json({message: 'Success'})
  } catch (e) {
    if (e.toJSON) {
      return json(e, {status: 500})
    } else {
      return json({message: e.message}, {status: 500})
    }
  }
}
