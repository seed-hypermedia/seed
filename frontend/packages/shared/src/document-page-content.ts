import {z} from 'zod'
import * as hm from '@seed-hypermedia/client'
import {signBlob} from '@seed-hypermedia/client/signed-blob'
import {
  HMBlockNodeSchema,
  HMPrepareDocumentChangeInputSchema,
  HMPublishBlobsInputSchema,
  HMRequestSchema,
  type HMDocument,
  type HMQueryResult,
  type HMQueryDocumentsOutput,
  type HMSigner,
  type HMRequest,
} from '@seed-hypermedia/client/hm-types'
import {createWebUniversalClient} from './create-web-universal-client'
import type {DocumentPageContext} from './document-page'
import type {UniversalClient} from './universal-client'

import {decode, encode} from '@ipld/dag-cbor'
import {
  createDocumentPageAccess,
  pageReadRequest,
  pageSignatureRequest,
  pageBytesDigest,
} from './document-page-permissions'
export {createDocumentPageAccess} from './document-page-permissions'

/** Signing helpers delegate to the existing HM SDK with a host-held, revocable signer. */
export const DOCUMENT_PAGE_SIGNING_HELPERS = {
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
export async function documentPageContent({
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
  context: DocumentPageContext
  visibility: HMDocument['visibility']
  client: Pick<UniversalClient, 'getSigner' | 'publish' | 'request'>
  access: ReturnType<typeof createDocumentPageAccess>
  signal: AbortSignal
}): Promise<unknown> {
  signal.throwIfAborted()
  params = structuredClone(params)
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
  const authorized = access.signal(signal)
  const signer: HMSigner = {
    getPublicKey: async () => {
      authorized.throwIfAborted()
      if (!account || !client.getSigner) throw new Error('Sign in to sign with this page.')
      const result = await client.getSigner(account).getPublicKey()
      authorized.throwIfAborted()
      return result
    },
    sign: async (data) => {
      const bytes = new Uint8Array(data)
      const principal = await signer.getPublicKey()
      const request = pageSignatureRequest(bytes, principal)
      request.details = {payload: request.details, sha256: await pageBytesDigest(bytes)}
      await access.authorize(request, authorized)
      authorized.throwIfAborted()
      const result = new Uint8Array(await client.getSigner!(account!).sign(bytes))
      authorized.throwIfAborted()
      // Only exact envelopes signed through this bridge can be published without a second prompt.
      if (request.type !== 'raw') {
        const body = decode(bytes) as Record<string, unknown>
        await access.allowPublication(encode({...body, sig: result}), authorized)
      }
      authorized.throwIfAborted()
      return result
    },
  }
  const publish: UniversalClient['publish'] = async (input) => {
    authorized.throwIfAborted()
    const payload = structuredClone(input)
    const unknown = []
    for (const blob of payload.blobs) {
      if (!(await access.canPublish(blob.data)))
        unknown.push({bytes: blob.data.byteLength, sha256: await pageBytesDigest(blob.data)})
    }
    if (unknown.length)
      await access.authorize(
        {
          kind: 'publish',
          type: 'Publication',
          title: 'Publish data',
          details: unknown,
          warning:
            'These bytes were not signed and approved in this page session. Publishing can disclose data permanently.',
        },
        authorized,
      )
    authorized.throwIfAborted()
    const result = await client.publish(payload)
    authorized.throwIfAborted()
    return result
  }
  const pageSpace = hm.unpackHmId(context.document)?.uid
  const authorizeRead = async (key: HMRequest['key'], input: unknown) => {
    const permission = pageReadRequest(key, input)
    if (!pageSpace || permission.site !== pageSpace) await access.authorize(permission, authorized)
    authorized.throwIfAborted()
  }
  const request = (async (key: HMRequest['key'], input: HMRequest['input']) => {
    if (key === 'PublishBlobs') return publish(HMPublishBlobsInputSchema.parse(input))
    await authorizeRead(key, input)
    authorized.throwIfAborted()
    const result = await client.request(key, input, {signal: authorized})
    authorized.throwIfAborted()
    // Check the resolved resource as well: a redirect must not widen a resource or site grant.
    if ((key === 'Resource' || key === 'ResourceMetadata') && result && typeof result === 'object') {
      const resolved = result as {id?: {uid?: string; path?: string[]}; document?: {account?: string; path?: string}}
      const uid = resolved.document?.account || resolved.id?.uid
      const path = resolved.document?.path?.split('/').filter(Boolean) ?? resolved.id?.path ?? []
      const requested = input as {uid: string; path?: string[]}
      if (uid && hm.packBaseId(uid, path) !== hm.packBaseId(requested.uid, requested.path || [])) {
        await authorizeRead(key, {uid, path})
      }
    }
    const querySite = pageReadRequest(key, input).site
    if (key === 'Query' && querySite && result) {
      for (const item of (result as HMQueryResult).results) {
        if (item.id.uid !== querySite) await authorizeRead('ResourceMetadata', item.id)
      }
    }
    if (key === 'QueryDocuments' && querySite && result) {
      for (const item of (result as HMQueryDocumentsOutput).documents || []) {
        if (item.account !== querySite)
          await authorizeRead('ResourceMetadata', {uid: item.account, path: item.path?.split('/').filter(Boolean)})
      }
    }
    authorized.throwIfAborted()
    return result
  }) as UniversalClient['request']
  const object = z.record(z.unknown()).parse(params)
  if (method === 'permissions.request') return {grants: access.snapshot()}
  if (method === 'context' || method === 'profile' || method === 'signer.getPublicKey') {
    if (account)
      await access.authorize(
        {
          kind: 'read',
          type: 'Account',
          title: 'Identify your account',
          resource: `hm://${account}/:profile`,
          details: {account},
          warning: 'This links your selected identity to the page.',
        },
        authorized,
      )
    if (method === 'context') return context
    if (method === 'signer.getPublicKey') return signer.getPublicKey()
    if (!account) return null
    const profile = await client.request('Account', account, {signal: authorized})
    authorized.throwIfAborted()
    return {id: account, name: profile?.type === 'account' ? profile.metadata?.name || null : null}
  }
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
    if (!account) throw new Error('Sign in to publish a document.')
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
    if (!id.version && hm.packBaseId(id.uid, id.path || []) === context.document) id.version = context.version
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
    if (Object.hasOwn(DOCUMENT_PAGE_SIGNING_HELPERS, name)) {
      const helper = DOCUMENT_PAGE_SIGNING_HELPERS[name as keyof typeof DOCUMENT_PAGE_SIGNING_HELPERS]
      const result = await helper(object.input as never, signer)
      authorized.throwIfAborted()
      return result
    }
  }
  throw new Error('Unknown page operation.')
}
