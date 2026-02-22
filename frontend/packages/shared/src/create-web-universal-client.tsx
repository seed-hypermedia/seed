import type {HMRequest, HMSigner, UnpackedHypermediaId} from './hm-types'
import type {UniversalClient} from './universal-client'

export type WebClientDependencies = {
  // Type-safe request function (from createSeedClient or compatible)
  request: <Req extends HMRequest>(
    key: Req['key'],
    input: Req['input'],
  ) => Promise<Req['output']>

  // POST CBOR-encoded data to an API endpoint
  postCBOR?: (url: string, data: any) => Promise<any>

  // Comment editor component
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element

  // Recents management (optional)
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>

  // Platform-specific signing
  getSigner?: (accountUid: string) => HMSigner
}

export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  return {
    CommentEditor: deps.CommentEditor,
    fetchRecents: deps.fetchRecents,
    deleteRecent: deps.deleteRecent,

    getSigner: deps.getSigner,

    request: deps.request,
  }
}
