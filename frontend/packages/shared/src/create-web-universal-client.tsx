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

export type WebClientDependencies = {
  // API utilities
  queryAPI: <T>(url: string) => Promise<T>
  useAPI: <T>(url?: string, options?: any) => UseQueryResult<T>

  // Comment editor component
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element

  // Recents management (optional)
  loadRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>
}

export type DirectoryPayload = {
  directory: HMDocumentInfo[]
}

export function createWebUniversalClient(
  deps: WebClientDependencies,
): UniversalClient {
  return {
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
      const result = deps.useAPI<DirectoryPayload>(url)

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

    CommentEditor: deps.CommentEditor,

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
      return deps.queryAPI<SearchPayload>(url)
    },

    loadResource: (id: UnpackedHypermediaId): Promise<HMResource> => {
      const queryString = new URLSearchParams({
        v: id?.version || '',
        l: id?.latest ? 'true' : '',
      }).toString()
      const url = `/hm/api/resource/${id?.uid}${
        id?.path ? `/${id.path.join('/')}` : ''
      }?${queryString}`
      return deps.queryAPI<HMResource>(url)
    },

    loadAccount: async (accountUid: string) => {
      const response = await deps.queryAPI<HMMetadataPayload>(
        `/hm/api/account/${accountUid}`,
      )
      return HMMetadataPayloadSchema.parse(response)
    },

    loadBatchAccounts: async (accountUids: string[]) => {
      const results: Record<string, HMMetadataPayload> = {}
      await Promise.all(
        accountUids.map(async (uid) => {
          try {
            const response = await deps.queryAPI<HMMetadataPayload>(
              `/hm/api/account/${uid}`,
            )
            results[uid] = HMMetadataPayloadSchema.parse(response)
          } catch (e) {
            console.error(`Failed to load account ${uid}`, e)
          }
        }),
      )
      return results
    },

    loadRecents: deps.loadRecents || (async () => []),

    deleteRecent: deps.deleteRecent || (async () => {}),
  }
}
