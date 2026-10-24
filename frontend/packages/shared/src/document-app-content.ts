import {z} from 'zod'
import * as hm from '@seed-hypermedia/client'
import {signBlob} from '@seed-hypermedia/client/signed-blob'
import {
  HMBlockNodeSchema,
  HMPrepareDocumentChangeInputSchema,
  HMPublishBlobsInputSchema,
  HMRequestSchema,
  type HMDocument,
  type HMSigner,
  type HMRequest,
} from '@seed-hypermedia/client/hm-types'
import {createWebUniversalClient} from './create-web-universal-client'
import type {DocumentAppContext} from './document-app'
import type {UniversalClient} from './universal-client'

/** Full account access belongs to one viewer, app resource and code revision. */
export function createDocumentAppAccess(
  approve: (signal: AbortSignal) => Promise<boolean>,
  onChange: (granted: boolean) => void = () => {},
) {
  let controller = new AbortController()
  let granted = false
  let pending: Promise<boolean> | undefined
  return {
    async authorize(signal: AbortSignal) {
      const authorizationSignal = AbortSignal.any([signal, controller.signal])
      authorizationSignal.throwIfAborted()
      if (!granted) {
        if (!pending) {
          const approval = approve(authorizationSignal)
          pending = approval
          void approval
            .finally(() => {
              if (pending === approval) pending = undefined
            })
            .catch(() => {})
        }
        const accepted = await pending
        authorizationSignal.throwIfAborted()
        if (!accepted) throw new Error('Account access denied.')
        granted = true
        onChange(true)
      }
      return authorizationSignal
    },
    revoke() {
      granted = false
      pending = undefined
      controller.abort(new Error('App account access revoked.'))
      controller = new AbortController()
      onChange(false)
    },
  }
}

/** Signing helpers delegate to the existing HM SDK with a host-held, revocable signer. */
export const DOCUMENT_APP_SIGNING_HELPERS = {
  createComment: (input: hm.CreateCommentInput, signer: HMSigner) => hm.createComment(input, signer),
  updateComment: (input: hm.UpdateCommentInput, signer: HMSigner) => hm.updateComment(input, signer),
  deleteComment: (input: hm.DeleteCommentInput, signer: HMSigner) => hm.deleteComment(input, signer),
  createDocumentBlobs: (input: hm.CreateDocumentBlobsInput, signer: HMSigner) => hm.createDocumentBlobs(signer, input),
  createVersionRef: (input: hm.CreateVersionRefInput, signer: HMSigner) => hm.createVersionRef(input, signer),
  createRedirectRef: (input: hm.CreateRedirectRefInput, signer: HMSigner) => hm.createRedirectRef(input, signer),
  createTombstoneRef: (input: hm.CreateTombstoneRefInput, signer: HMSigner) => hm.createTombstoneRef(input, signer),
  createCapability: (input: hm.CreateCapabilityInput, signer: HMSigner) => hm.createCapability(input, signer),
  createContact: (input: hm.CreateContactInput, signer: HMSigner) => hm.createContact(input, signer),
  updateContact: (input: hm.UpdateContactInput, signer: HMSigner) => hm.updateContact(input, signer),
  deleteContact: (input: hm.DeleteContactInput, signer: HMSigner) => hm.deleteContact(input, signer),
  signDocumentChange: async (input: hm.SignDocumentChangeInput, signer: HMSigner) => {
    const {changeCid, ...result} = await hm.signDocumentChange(input, signer)
    return {...result, changeCid: changeCid.toString()}
  },
  signBlob: (input: Record<string, unknown>, signer: HMSigner) => signBlob(signer, input),
}

/** Dispatch SDK calls through the selected viewer's client; never return a key or privileged client. */
export async function documentAppContent({
  method,
  params,
  context,
  visibility,
  client,
  access,
  signal,
}: {
  method: string
  params: unknown
  context: DocumentAppContext
  visibility: HMDocument['visibility']
  client: Pick<UniversalClient, 'getSigner' | 'publish' | 'request'>
  access: ReturnType<typeof createDocumentAppAccess>
  signal: AbortSignal
}): Promise<unknown> {
  signal.throwIfAborted()
  if (method === 'hm.parseMarkdown') {
    const {markdown} = z.object({markdown: z.string()}).strict().parse(params)
    return hm.markdownBlockNodesToHMBlockNodes(hm.parseMarkdown(markdown).tree)
  }
  if (method === 'hm.validateContent')
    return z
      .object({content: z.array(HMBlockNodeSchema)})
      .strict()
      .parse(params).content
  if (method === 'hm.unpackHmId') return hm.unpackHmId(z.object({url: z.string()}).strict().parse(params).url)
  if (method === 'permissions.revoke') {
    access.revoke()
    return null
  }
  const {account} = context
  if (!account || !client.getSigner) throw new Error('Sign in to give this app account access.')
  const authorized = await access.authorize(signal)
  const currentSigner = client.getSigner(account)
  const signer: HMSigner = {
    getPublicKey: async () => {
      authorized.throwIfAborted()
      const result = await currentSigner.getPublicKey()
      authorized.throwIfAborted()
      return result
    },
    sign: async (data) => {
      authorized.throwIfAborted()
      const result = await currentSigner.sign(new Uint8Array(data))
      authorized.throwIfAborted()
      return result
    },
  }
  const request = (async (key: HMRequest['key'], input: HMRequest['input']) => {
    authorized.throwIfAborted()
    const result = await client.request(key, input, {signal: authorized})
    authorized.throwIfAborted()
    return result
  }) as UniversalClient['request']
  const publish: UniversalClient['publish'] = async (input) => {
    authorized.throwIfAborted()
    const result = await client.publish(input)
    authorized.throwIfAborted()
    return result
  }
  const object = z.record(z.unknown()).parse(params)
  if (method === 'permissions.request') return {account, document: context.document, app: context.app}
  if (method === 'signer.getPublicKey') return signer.getPublicKey()
  if (method === 'signer.sign') return signer.sign(z.instanceof(Uint8Array).parse(object.data))
  if (method === 'request') {
    const key = z.string().parse(object.key)
    const schema = HMRequestSchema.options.find((schema) => schema.shape.key.value === key)
    if (!schema) throw new Error('Unknown Hypermedia request.')
    const input = schema.shape.input.parse(object.input)
    return request(key as HMRequest['key'], input)
  }
  if (method === 'publish') return publish(HMPublishBlobsInputSchema.parse(object.input))
  if (method === 'publishDocument') {
    const input = HMPrepareDocumentChangeInputSchema.extend({
      genesis: z.string().optional(),
      generation: z.union([z.number(), z.bigint()]).optional(),
    })
      .strict()
      .parse(object.input)
    const publishingClient = createWebUniversalClient({
      request,
      publish,
      getSigner: () => signer,
    })
    await publishingClient.publishDocument!({...input, signerAccountUid: account})
    return {document: hm.packBaseId(input.account, input.path?.split('/').filter(Boolean) || [])}
  }
  if (method === 'resource') {
    const id = hm.unpackHmId(z.string().parse(object.url))
    if (!id) throw new Error('Expected an hm:// URL')
    if (id.path?.length === 1 && id.path[0] === ':profile') {
      const profile = await request('Account', id.uid)
      return {id: id.uid, name: profile?.type === 'account' ? profile.metadata?.name || null : null}
    }
    return request('Resource', id)
  }
  if (method === 'directory') {
    const id = hm.unpackHmId(z.string().parse(object.url))
    if (!id) throw new Error('Expected an hm:// URL')
    const result = await request('Query', {
      includes: [
        {space: id.uid, path: hm.hmIdPathToEntityQueryPath(id.path), mode: object.all ? 'AllDescendants' : 'Children'},
      ],
    })
    return result?.results || []
  }
  if (method === 'comments.create') {
    const input = z
      .object({
        content: z.array(HMBlockNodeSchema).min(1),
        target: z.string().optional(),
        version: z.string().optional(),
      })
      .strict()
      .parse(params)
    const docId = hm.unpackHmId(input.target || context.document)
    const version = input.version || (input.target ? docId?.version : context.version)
    if (!docId || !version) throw new Error('A comment target needs a document and version.')
    const content = hm.trimTrailingEmptyBlocks(input.content)
    if (!content.length) throw new Error('Write a comment before submitting.')
    const targetDocument = input.target ? await request('Resource', docId) : null
    const targetVisibility = input.target
      ? targetDocument?.type === 'document'
        ? targetDocument.document.visibility
        : undefined
      : visibility
    if (input.target && targetDocument?.type !== 'document') throw new Error('Comment target is not a document.')
    const payload = await hm.createComment(
      {docId, docVersion: version, content, visibility: targetVisibility === 'PRIVATE' ? 'Private' : ''},
      signer,
    )
    const commentId = await hm.commentRecordIdFromBlob(payload.blobs[0]!.data)
    const result = await publish(payload)
    if (!result.cids[0]) throw new Error('The comment could not be published.')
    return {commentId, version: result.cids[0]}
  }
  if (method.startsWith('hm.')) {
    const name = method.slice(3)
    if (Object.hasOwn(DOCUMENT_APP_SIGNING_HELPERS, name)) {
      const helper = DOCUMENT_APP_SIGNING_HELPERS[name as keyof typeof DOCUMENT_APP_SIGNING_HELPERS]
      const result = await helper(object.input as never, signer)
      authorized.throwIfAborted()
      return result
    }
  }
  throw new Error('Unknown app operation.')
}
