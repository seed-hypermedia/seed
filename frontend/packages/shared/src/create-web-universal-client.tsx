import {UseQueryResult} from '@tanstack/react-query'
import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMMetadataPayload,
  HMQuery,
  HMQueryResult,
  HMResource,
  UnpackedHypermediaId,
} from './hm-types'
import {HMMetadataPayloadSchema} from './hm-types'
import {useResource, useResources} from './models/entity'
import type {Contact, SearchPayload, UniversalClient} from './universal-client'
import {hmId, packHmId} from './utils/entity-id-url'

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
      _options?: {recursive?: boolean},
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

    loadQuery: async (_query: HMQuery): Promise<HMQueryResult | null> => {
      console.error('loadQuery not yet implemented for web')
      return null
    },

    deleteRecent: deps.deleteRecent || (async () => {}),
  }
}
