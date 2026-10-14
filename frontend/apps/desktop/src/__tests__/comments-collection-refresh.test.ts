import type {HMComment} from '@seed-hypermedia/client/hm-types'
import {useDeleteComment, useUpdateComment} from '@shm/shared/comments-service-provider'
import {queryClient, registerQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UniversalAppContext} from '@shm/shared/routing'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'

const account = 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou'
const version = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const comment: HMComment = {
  id: `${account}/z3T56RpZJjd`,
  author: account,
  version,
  targetAccount: account,
  targetPath: '/old-document',
  targetVersion: version,
  content: [],
  createTime: '2026-01-01T00:00:00Z',
  updateTime: '2026-01-01T00:00:00Z',
  visibility: 'PUBLIC',
}

describe('comment mutations refresh collection results', () => {
  it.each(['edit', 'delete'] as const)(
    '%s refreshes an inactive collection before it is opened again',
    async (operation) => {
      const client = new QueryClient({
        defaultOptions: {queries: {retry: false, staleTime: Infinity, refetchOnMount: false}},
      })
      registerQueryClient(client)
      const key = [queryKeys.QUERY_BLOCK, {sort: [{term: 'activity', reverse: true}]}]
      let documents = operation === 'edit' ? ['recent-update', 'old-document'] : ['old-document', 'recent-update']
      const nextDocuments = [...documents].reverse()
      await client.fetchQuery({queryKey: key, queryFn: async () => documents})
      let mutate: (() => Promise<unknown>) | undefined
      function MutationHarness() {
        const update = useUpdateComment()
        const remove = useDeleteComment()
        mutate = () =>
          operation === 'edit'
            ? update.mutateAsync({
                comment,
                signingAccountId: account,
                newContent: [
                  {block: {id: 'p', type: 'Paragraph', text: 'Edited', attributes: {}, annotations: []}, children: []},
                ],
              })
            : remove.mutateAsync({comment, signingAccountId: account})
        return null
      }

      try {
        renderToString(
          createElement(
            QueryClientProvider,
            {client},
            createElement(
              UniversalAppContext.Provider,
              {
                value: {
                  openUrl: () => {},
                  universalClient: {
                    request: async () => {
                      throw new Error('Unexpected request')
                    },
                    getSigner: () => ({
                      getPublicKey: async () => new Uint8Array(34).fill(7),
                      sign: async () => new Uint8Array(64).fill(9),
                    }),
                    publish: async () => {
                      documents = nextDocuments
                      return {cids: []}
                    },
                  },
                },
              },
              createElement(MutationHarness),
            ),
          ),
        )
        await mutate!()
        await vi.waitFor(() => expect(client.getQueryData(key)).toEqual(nextDocuments))
      } finally {
        client.clear()
        registerQueryClient(queryClient)
      }
    },
  )
})
