import {createDocumentChange, createGenesisChange, createVersionRef, signDocumentChange} from '@seed-hypermedia/client'
import type {HMRequest, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {PublishDocumentInput, UniversalClient} from './universal-client'

export type WebClientDependencies = Pick<UniversalClient, 'request' | 'publish'> & {
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>
  getSigner?: (accountUid: string) => HMSigner
}

export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  async function publishDocument(input: PublishDocumentInput): Promise<void> {
    if (!deps.getSigner) throw new Error('getSigner is required for publishDocument')
    const signer = deps.getSigner(input.signerAccountUid)

    // Bootstrap brand-new home documents client-side. Other new documents go
    // through PrepareDocumentChange so the server can prepare richer ops.
    if (!input.genesis && !input.baseVersion && !input.path) {
      const genesisChange = await createGenesisChange(signer)
      const contentChange = await createDocumentChange(
        {
          changes: input.changes,
          genesisCid: genesisChange.cid,
          deps: [genesisChange.cid],
          depth: 1,
        },
        signer,
      )
      const ref = await createVersionRef(
        {
          space: input.account,
          path: '',
          genesis: genesisChange.cid.toString(),
          version: contentChange.cid.toString(),
          generation: input.generation != null ? Number(input.generation) : 1,
          capability: input.capability,
          message: input.message,
        },
        signer,
      )
      await deps.publish({
        blobs: [
          {data: genesisChange.bytes, cid: genesisChange.cid.toString()},
          {data: contentChange.bytes, cid: contentChange.cid.toString()},
          ...ref.blobs,
        ],
      })
      return
    }

    // Use PrepareDocumentChange for both new and existing documents so the server
    // can prepare all supported ops.
    const {unsignedChange} = (await deps.request('PrepareDocumentChange', {
      account: input.account,
      path: input.path,
      baseVersion: input.baseVersion,
      changes: input.changes,
      capability: input.capability,
      visibility: input.visibility,
    })) as Extract<HMRequest, {key: 'PrepareDocumentChange'}>['output']
    const {publishInput} = await signDocumentChange(
      {
        account: input.account,
        path: input.path,
        unsignedChange,
        genesis: input.genesis,
        generation: input.generation,
        capability: input.capability,
        visibility: input.visibility,
        message: input.message,
      },
      signer,
    )
    await deps.publish(publishInput)
  }

  return {
    CommentEditor: deps.CommentEditor,
    fetchRecents: deps.fetchRecents,
    deleteRecent: deps.deleteRecent,

    getSigner: deps.getSigner,

    request: deps.request,
    publish: deps.publish,

    publishDocument: deps.getSigner ? publishDocument : undefined,
  }
}
