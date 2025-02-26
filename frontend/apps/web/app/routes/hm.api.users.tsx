import {createUser} from '@/db'
import {ActionFunction, json} from '@remix-run/node'
import {z} from 'zod'

const createUserSchema = z
  .object({
    username: z.string(),
    publicKey: z.string(),
    credId: z.string(),
  })
  .strict()

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  const data = await request.json()
  const payload = createUserSchema.parse(data)
  console.log(payload)
  await createUser(payload)

  return json({
    message: 'Success',
  })
}
