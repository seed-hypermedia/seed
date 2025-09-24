import {ActionFunction} from 'react-router'
import {json} from '@/utils/json'
import {z} from 'zod'

const publishSchema = z
  .object({
    name: z.string(),
    username: z.string(),
    publicKey: z.string(),
    signature: z.string(),
  })
  .strict()

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  const data = await request.json()
  const payload = publishSchema.parse(data)
  console.log(payload)

  return json({
    message: 'Success',
  })
}
