import {isMountableAgentServerUrl} from '@seed-hypermedia/apps-protocol'
import {
  AttributeValue,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_Comparison,
  DocumentFilter_Comparison_Operator,
  DocumentFilter_SpaceMatch,
  QueryDocumentsRequest,
} from '@shm/shared/client/grpc-types'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useUniversalClient} from '@shm/shared/routing'
import {useQuery} from '@tanstack/react-query'

/**
 * The agents of a space are its mount documents: a document with `type: hm://hyper.media/agent`
 * and an `agentServerUrl`. Nothing else registers an agent with a space, so finding a space's
 * agents is a document query, not a question for any agents server. The query is small and runs
 * on the client after the page is up, so a page never waits on it.
 *
 * Kept free of the agents models (which carry the editor) so the site header can ask whether a
 * space has agents without pulling that chunk into the initial bundle.
 */

/** The `type` attribute of an agent's mount document. */
export const AGENT_DOCUMENT_TYPE = 'hm://hyper.media/agent'

/** One agent mounted in a space, as its document declares it. */
export type SiteAgentMount = {
  /** The agent's id: the document's versionless hm:// id. */
  agentId: string
  /** The agents server the document names, as written (mountable: http(s), no credentials). */
  serverUrl: string
  /** The document's name attribute, which is also the agent's name. */
  name: string
  path: string
}

/** A document as the query returns it: the space, the `/`-prefixed path, and its metadata. */
export type AgentDocumentLike = {account: string; path: string; metadata?: Record<string, unknown> | null}

const PAGE_SIZE = 200
const MAX_PAGES = 5

export function siteAgentMountsQueryKey(siteUid: string | null | undefined) {
  return [queryKeys.ENTITY, 'site-agent-mounts', siteUid ?? null] as const
}

/** Reads the mounts out of a space's agent-typed documents, in path order; documents naming no usable server are skipped. */
export function siteAgentMountsFromDocuments(documents: AgentDocumentLike[]): SiteAgentMount[] {
  const mounts: SiteAgentMount[] = []
  for (const document of documents) {
    const metadata = document.metadata
    const serverUrl = metadata?.agentServerUrl
    if (
      metadata?.type !== AGENT_DOCUMENT_TYPE ||
      typeof serverUrl !== 'string' ||
      !isMountableAgentServerUrl(serverUrl)
    )
      continue
    // A mount lives at a path; the home document is never an agent.
    const path = document.path.startsWith('/') ? document.path : `/${document.path}`
    if (path === '/' || !document.account) continue
    const name =
      typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : path.split('/').pop() || path
    // The agent id is the document's versionless id, exactly as the server registered it.
    mounts.push({agentId: `hm://${document.account}${path}`, serverUrl, name, path})
  }
  return mounts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Every agent mounted in the space, found through its documents. Empty where documents cannot be queried. */
export function useSiteAgentMounts(siteUid: string | null | undefined) {
  const client = useUniversalClient()
  const canQuery = !!client.queryDocuments
  return useQuery({
    queryKey: siteAgentMountsQueryKey(siteUid),
    enabled: !!siteUid && canQuery,
    // The header, the auto-open and the panel all ask; one answer serves them for a while, and a
    // newly mounted agent shows up on the next navigation or within the minute.
    staleTime: 60_000,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<SiteAgentMount[]> => {
      if (!siteUid || !client.queryDocuments) return []
      const filter = new DocumentFilter({
        filter: {
          case: 'and',
          value: new DocumentFilter_And({
            filters: [
              new DocumentFilter({
                filter: {case: 'spaceMatch', value: new DocumentFilter_SpaceMatch({space: siteUid})},
              }),
              new DocumentFilter({
                filter: {
                  case: 'comparison',
                  value: new DocumentFilter_Comparison({
                    key: 'type',
                    operator: DocumentFilter_Comparison_Operator.EQUAL,
                    value: new AttributeValue({value: {case: 'stringValue', value: AGENT_DOCUMENT_TYPE}}),
                  }),
                },
              }),
            ],
          }),
        },
      })
      const documents: AgentDocumentLike[] = []
      let pageToken = ''
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await client.queryDocuments(
          new QueryDocumentsRequest({filter, pageSize: PAGE_SIZE, pageToken}),
          {signal},
        )
        for (const document of response.documents) {
          documents.push({
            account: document.account,
            path: document.path,
            metadata: (document.metadata?.toJson() ?? null) as Record<string, unknown> | null,
          })
        }
        pageToken = response.nextPageToken
        if (!pageToken) break
      }
      return siteAgentMountsFromDocuments(documents)
    },
  })
}
