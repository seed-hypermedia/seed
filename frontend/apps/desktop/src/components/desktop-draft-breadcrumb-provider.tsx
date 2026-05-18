import {useAccountDraftList} from '@/models/documents'
import {DraftBreadcrumbContext, DraftBreadcrumbContextValue} from '@shm/shared/draft-breadcrumb-context'
import {PropsWithChildren, useMemo} from 'react'

/**
 * Provides the draft list needed by the document-header breadcrumb so we can
 * substitute draft metadata (and skip the daemon `Resource` fetch) for
 * segments backed by a local draft. Mounted at the resource-page level so it
 * covers every breadcrumb rendered in the document view.
 */
export function DesktopDraftBreadcrumbProvider({children}: PropsWithChildren) {
  const value = useMemo<DraftBreadcrumbContextValue>(
    () => ({
      useDraftsForAccount: (uid: string | undefined) => {
        const query = useAccountDraftList(uid)
        return {data: query.data, isLoading: query.isLoading}
      },
    }),
    [],
  )

  return <DraftBreadcrumbContext.Provider value={value}>{children}</DraftBreadcrumbContext.Provider>
}
