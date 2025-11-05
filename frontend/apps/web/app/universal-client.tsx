import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMMetadataPayload,
  HMResource,
  UnpackedHypermediaId,
} from '@shm/shared'
import {hmId, HMMetadataPayloadSchema, packHmId} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import type {
  Contact,
  SearchPayload,
  UniversalClient,
} from '@shm/shared/universal-client'
import {UseQueryResult} from '@tanstack/react-query'
import WebCommenting from './commenting'
import {deleteRecent, getRecents} from './local-db-recents'
import {queryAPI, useAPI} from './models'
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

  loadSearch: async (
    input: string,
    {
      accountUid,
      includeBody,
      contextSize,
      perspectiveAccountUid,
    }: {
      accountUid?: string
      includeBody?: boolean
      contextSize?: number
      perspectiveAccountUid?: string
    } = {},
  ) => {
    const url = `/hm/api/search?q=${input}&a=${
      accountUid || ''
    }&b=${includeBody}&c=${contextSize}&d=${perspectiveAccountUid || ''}`
    return queryAPI<SearchPayload>(url)
  },

  loadResource: (id: UnpackedHypermediaId): Promise<HMResource> => {
    const queryString = new URLSearchParams({
      v: id?.version || '',
      l: id?.latest ? 'true' : '',
    }).toString()
    const url = `/hm/api/resource/${id?.uid}${
      id?.path ? `/${id.path.join('/')}` : ''
    }?${queryString}`
    return queryAPI<HMResource>(url)
  },

  loadAccount: async (accountUid: string) => {
    const response = await queryAPI<HMMetadataPayload>(
      `/hm/api/account/${accountUid}`,
    )
    return HMMetadataPayloadSchema.parse(response)
  },

  loadBatchAccounts: async (accountUids: string[]) => {
    const results: Record<string, HMMetadataPayload> = {}
    await Promise.all(
      accountUids.map(async (uid) => {
        try {
          results[uid] = await webUniversalClient.loadAccount(uid)
        } catch (e) {
          console.error(`Failed to load account ${uid}`, e)
        }
      }),
    )
    return results
  },

  loadRecents: getRecents,

  deleteRecent: deleteRecent,
}
