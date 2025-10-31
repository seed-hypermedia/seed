import type {HMAccountsMetadata, UnpackedHypermediaId} from '@shm/shared'
import {hmId} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import type {Contact, UniversalClient} from '@shm/shared/universal-client'
import {UseQueryResult} from '@tanstack/react-query'
import WebCommenting from './commenting'

export const webUniversalClient: UniversalClient = {
  useResource: ((
    id: UnpackedHypermediaId | null | undefined,
    options?: {recursive?: boolean},
  ) => {
    return useResource(id)
  }) as UniversalClient['useResource'],
  useResources: useResources,

  // Web doesn't support direct directory listing - relies on SSR context
  useDirectory: () => {
    throw new Error(
      'Web platform does not support direct directory listing. Use supportQueries from DocContentContext instead.',
    )
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
