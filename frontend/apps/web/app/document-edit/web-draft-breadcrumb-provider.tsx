import {DraftBreadcrumbContext, DraftBreadcrumbContextValue} from '@shm/shared/draft-breadcrumb-context'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'
import {PropsWithChildren, useMemo} from 'react'
import {listWebDocDraftsForAccount, webDraftToListedDraft} from './web-draft-db'

function useWebAccountDraftList(uid: string | undefined) {
  return useQuery({
    queryKey: [queryKeys.DRAFTS_LIST_ACCOUNT, uid],
    queryFn: async () => {
      const drafts = await listWebDocDraftsForAccount(uid)
      return drafts.map(webDraftToListedDraft)
    },
    enabled: !!uid,
  })
}

/** Provides IndexedDB-backed local web drafts to shared document UI. */
export function WebDraftBreadcrumbProvider({children}: PropsWithChildren) {
  const value = useMemo<DraftBreadcrumbContextValue>(
    () => ({
      useDraftsForAccount: (uid: string | undefined) => {
        const query = useWebAccountDraftList(uid)
        return {data: query.data, isLoading: query.isLoading}
      },
    }),
    [],
  )

  return <DraftBreadcrumbContext.Provider value={value}>{children}</DraftBreadcrumbContext.Provider>
}
