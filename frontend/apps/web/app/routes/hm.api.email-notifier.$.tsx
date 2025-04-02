import {cborDecode} from '@/api'
import {getAccount, getEmail, setAccount} from '@/db'
import {sendNotificationWelcomeEmail} from '@/emails'
import {getMetadata} from '@/loaders'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {ActionFunction, LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

export const loader: LoaderFunction = async ({request, params}) => {
  // const url = new URL(request.url)
  const accountId = params['*']?.split('/')[0]

  if (!accountId) {
    return json({error: 'No user ID provided'}, {status: 400})
  }

  return json({})
}

const emailNotifierAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-email-notifications'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('set-email-notifications'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    email: z.string(),
    notifyAllMentions: z.boolean(),
    notifyAllReplies: z.boolean(),
  }),
])

export type EmailNotifierAction = z.infer<typeof emailNotifierAction>

export const action: ActionFunction = async ({request, params}) => {
  const accountId = params['*']?.split('/')[0]
  if (!accountId) {
    return json({error: 'No user ID provided'}, {status: 400})
  }
  const cborData = await request.arrayBuffer()
  const signedPayload = emailNotifierAction.parse(
    cborDecode(new Uint8Array(cborData)),
  )
  if (base58btc.encode(signedPayload.signer) !== accountId) {
    return json({error: 'Mismatched signer and account ID'}, {status: 400})
  }
  const {sig, ...restPayload} = signedPayload
  const isValid = await validateSignature(
    signedPayload.signer,
    signedPayload.sig,
    cborEncode(restPayload),
  )
  if (!isValid) {
    return json({error: 'Invalid signature'}, {status: 400})
  }
  const now = Date.now()
  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    // 20 seconds to account for clock skew and network
    return json({error: 'Request time invalid'}, {status: 400})
  }
  if (restPayload.action === 'get-email-notifications') {
    const account = getAccount(accountId)
    return json({
      account,
    })
  }
  if (restPayload.action === 'set-email-notifications') {
    const email = getEmail(restPayload.email)
    setAccount({
      id: accountId,
      email: restPayload.email,
      notifyAllMentions: restPayload.notifyAllMentions,
      notifyAllReplies: restPayload.notifyAllReplies,
    })
    if (restPayload.email && !email) {
      const metadata = await getMetadata(hmId('d', accountId))
      if (!metadata.metadata) {
        console.error(
          'Account not found. Cannot send welcome email. ',
          accountId,
        )
        return json({})
      }
      const newEmail = getEmail(restPayload.email)
      if (!newEmail) {
        console.error(
          'Created email not found. Cannot send welcome email. ',
          restPayload.email,
        )
        return json({})
      }
      sendNotificationWelcomeEmail(restPayload.email, metadata.metadata, {
        adminToken: newEmail.adminToken,
        notifyAllMentions: restPayload.notifyAllMentions,
        notifyAllReplies: restPayload.notifyAllReplies,
      })
    }
    return json({})
  }
  return json({error: 'Invalid action'}, {status: 400})
}
