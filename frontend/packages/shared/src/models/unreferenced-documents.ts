import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {useQuery} from '@tanstack/react-query'
import {useUniversalClient} from '../routing'
import type {UniversalClient, UniversalClientRequestOptions} from '../universal-client'
import {queryKeys} from './query-keys'

type UnreferencedDocumentsClient = Required<Pick<UniversalClient, 'listUnreferencedDocuments'>>

/** Loads every page of the site-wide unreferenced document index. */
export async function fetchAllUnreferencedDocuments(
  client: UnreferencedDocumentsClient,
  siteAccount: string,
  options: UniversalClientRequestOptions = {},
): Promise<{documents: HMDocumentInfo[]; indexIncomplete: boolean}> {
  const documents: HMDocumentInfo[] = []
  let indexIncomplete = false
  let pageToken = ''

  do {
    const page = await client.listUnreferencedDocuments({siteAccount, pageSize: 100, pageToken}, options)
    documents.push(...page.documents)
    indexIncomplete ||= !!page.indexIncomplete
    pageToken = page.nextPageToken || ''
  } while (pageToken)

  return {documents, indexIncomplete}
}

/** Returns the complete, site-keyed unreferenced document list. */
export function useUnreferencedDocuments(siteAccount: string | undefined) {
  const client = useUniversalClient()
  const query = useQuery({
    queryKey: [queryKeys.DOC_LIST_UNREFERENCED, siteAccount],
    queryFn: ({signal}) => fetchAllUnreferencedDocuments(client as UnreferencedDocumentsClient, siteAccount!, {signal}),
    enabled: !!siteAccount && !!client.listUnreferencedDocuments,
  })

  return {
    documents: query.data?.documents ?? [],
    indexIncomplete: query.data?.indexIncomplete ?? false,
    isLoading: !!client.listUnreferencedDocuments && query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
