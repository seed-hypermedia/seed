import {signDocumentChange} from '@seed-hypermedia/client'
import type {HMRequest, HMSigner, UnpackedHypermediaId} from './hm-types'
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
