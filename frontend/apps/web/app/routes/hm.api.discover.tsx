import {discoverDocument} from '@/utils/discovery'
import {ActionFunction, json} from '@remix-run/node'
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
    await discoverDocument(input.uid, input.path, input.version)
    console.log('[discover][success]: ', input)
    return json({message: 'Success'})
  } catch (e) {
    if (e.toJSON) {
      return json(e, {status: 500})
    } else {
      return json({message: e.message}, {status: 500})
    }
  }
}
