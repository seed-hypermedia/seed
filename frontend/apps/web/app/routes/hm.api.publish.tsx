import {ActionFunction} from 'react-router'
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
    return Response.json({message: 'Method not allowed'}, {status: 405})
  }
  const body = await request.json()
  const payload = publishSchema.parse(body)
  console.log(payload)

  return Response.json({
    message: 'Success',
  })
}
