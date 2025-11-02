import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared'
import {hmId, packHmId} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import type {Contact, UniversalClient} from '@shm/shared/universal-client'
import {UseQueryResult} from '@tanstack/react-query'
import WebCommenting from './commenting'
import {useAPI} from './models'
import {DirectoryPayload} from './routes/hm.api.directory'

export const webUniversalClient: UniversalClient = {
  useResource: ((
    id: UnpackedHypermediaId | null | undefined,
    options?: {recursive?: boolean},
  ) => {
    return useResource(id)
  }) as UniversalClient['useResource'],
  useResources: useResources,

  useDirectory: (
    id: UnpackedHypermediaId,
    options?: {mode?: string},
  ): UseQueryResult<HMDocumentInfo[]> => {
    const mode = options?.mode || 'Children'
    const url = `/hm/api/directory?id=${packHmId(id)}&mode=${mode}`
    const result = useAPI<DirectoryPayload>(url)

    return {
      ...result,
      data: result.data?.directory || [],
    } as UseQueryResult<HMDocumentInfo[]>
  },

  // Web doesn't have contacts
  useContacts: () =>
    ({data: null, isLoading: false}) as UseQueryResult<Contact[] | null>,

  // Web accounts metadata - batch load via useResources
  useAccountsMetadata: (uids: string[]): HMAccountsMetadata => {
    const accounts = useResources(uids.map((uid) => hmId(uid)))
    return Object.fromEntries(
      accounts
        .map((account) => {
          if (!account.data || account.data.type !== 'document') return null
          return [
            account.data.id.uid,
            {id: account.data.id, metadata: account.data.document?.metadata},
          ]
        })
        .filter((entry) => !!entry),
    )
  },

  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => (
    <WebCommenting docId={docId} />
  ),
}
