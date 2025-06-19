import {queryClient} from '@/client'
import type {BaseAccount} from '@/db'
import {getAccount, getEmail, setAccount} from '@/db'
import {sendNotificationWelcomeEmail} from '@/emails'
import {getMetadata} from '@/loaders'
import {BadRequestError, cborApiAction} from '@/server-api'
import {withCors} from '@/utils/cors'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/react'
import {hmId, Role} from '@shm/shared'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

export const loader: LoaderFunction = async ({request, params}) => {
  // const url = new URL(request.url)
  const accountId = params['*']?.split('/')[0]

  if (!accountId) {
    return withCors(json({error: 'No user ID provided'}, {status: 400}))
  }

  return withCors(json({}))
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
    notifyOwnedDocChange: z.boolean(),
  }),
])

export type EmailNotifierAction = z.infer<typeof emailNotifierAction>

export type EmailNotifierAccountState = {
  account: BaseAccount | null
}

export const action = cborApiAction<EmailNotifierAction, any>(
  async (signedPayload, {pathParts}) => {
    const accountId = pathParts[3]
    if (!accountId) {
      throw new BadRequestError('No user ID provided')
    }
    const {sig, ...restPayload} = signedPayload
    const isValid = await validateSignature(
      signedPayload.signer,
      signedPayload.sig,
      cborEncode(restPayload),
    )
    if (!isValid) {
      throw new BadRequestError('Invalid signature')
    }
    const signerId = base58btc.encode(signedPayload.signer)
    if (signerId !== accountId) {
      const caps = await queryClient.accessControl.listCapabilitiesForDelegate({
        delegate: signerId,
      })
      const agentCap = caps.capabilities.find(
        (cap) => cap.role === Role.AGENT && cap.issuer === accountId,
      )
      if (!agentCap) {
        throw new BadRequestError(
          'Mismatched signer and account ID, with no matching agent capability found',
        )
      }
    }
    const now = Date.now()
    const timeDiff = Math.abs(now - restPayload.time)
    if (timeDiff > 20_000) {
      throw new BadRequestError('Request time invalid')
    }
    if (restPayload.action === 'get-email-notifications') {
      const account = getAccount(accountId)
      if (!account) {
        return {account: null} satisfies EmailNotifierAccountState
      }
      return {
        account,
      } satisfies EmailNotifierAccountState
    }
    if (restPayload.action === 'set-email-notifications') {
      const email = getEmail(restPayload.email)
      setAccount({
        id: accountId,
        email: restPayload.email,
        notifyAllMentions: restPayload.notifyAllMentions,
        notifyAllReplies: restPayload.notifyAllReplies,
        notifyOwnedDocChange: restPayload.notifyOwnedDocChange,
      })
      if (restPayload.email && !email) {
        const metadata = await getMetadata(hmId('d', accountId))
        if (!metadata.metadata) {
          console.error(
            'Account not found. Cannot send welcome email. ',
            accountId,
          )
          return {}
        }
        const newEmail = getEmail(restPayload.email)
        if (!newEmail) {
          console.error(
            'Created email not found. Cannot send welcome email. ',
            restPayload.email,
          )
          return {}
        }
        sendNotificationWelcomeEmail(restPayload.email, metadata.metadata, {
          adminToken: newEmail.adminToken,
          notifyAllMentions: restPayload.notifyAllMentions,
          notifyAllReplies: restPayload.notifyAllReplies,
          notifyOwnedDocChange: restPayload.notifyOwnedDocChange,
        })
      }
      return {}
    }
    throw new BadRequestError('Invalid action')
  },
)
