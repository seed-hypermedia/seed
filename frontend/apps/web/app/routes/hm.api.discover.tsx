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
    await discoverDocument(input.uid, input.path, input.version)
    return json({message: 'Success'})
  } catch (e) {
    if (e instanceof Error) {
      return json({message: e.message}, {status: 500})
    } else {
      return json({message: 'Unknown error'}, {status: 500})
    }
  }
}
