import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

export type SidebarSectionId = 'joined-sites' | 'following' | 'bookmarks' | 'library' | 'drafts'

export type SidebarSectionPrefs = {
  collapsed: boolean
  visible: boolean
  sortMode: 'activity' | 'alphabetical' | 'manual'
  itemOrder: string[]
}

const DEFAULT_SECTION_PREFS: SidebarSectionPrefs = {
  collapsed: false,
  visible: true,
  sortMode: 'activity',
  itemOrder: [],
}

const DEFAULT_SECTION_ORDER: SidebarSectionId[] = ['joined-sites', 'following', 'bookmarks', 'library', 'drafts']

export function useUIPreferences() {
  return useQuery({
    queryKey: [queryKeys.UI_PREFERENCES],
    queryFn: () => client.uiPreferences.get.query(),
  })
}

export function useSidebarSectionOrder(): SidebarSectionId[] {
  const prefs = useUIPreferences()
  return useMemo(() => (prefs.data?.sidebar?.sectionOrder as SidebarSectionId[]) || DEFAULT_SECTION_ORDER, [prefs.data])
}

export function useSidebarSectionPrefs(sectionId: SidebarSectionId): SidebarSectionPrefs {
  const prefs = useUIPreferences()
  return useMemo(() => {
    const stored = prefs.data?.sidebar?.sections?.[sectionId]
    return {...DEFAULT_SECTION_PREFS, ...stored}
  }, [prefs.data, sectionId])
}

function invalidateUIPreferences() {
  invalidateQueries([queryKeys.UI_PREFERENCES])
}

export function useSetSidebarCollapsed() {
  return useMutation({
    mutationFn: (input: {sectionId: SidebarSectionId; collapsed: boolean}) =>
      client.uiPreferences.setSidebarSectionPrefs.mutate({
        sectionId: input.sectionId,
        prefs: {collapsed: input.collapsed},
      }),
    onSuccess: invalidateUIPreferences,
  })
}

export function useSetSidebarVisible() {
  return useMutation({
    mutationFn: (input: {sectionId: SidebarSectionId; visible: boolean}) =>
      client.uiPreferences.setSidebarSectionPrefs.mutate({
        sectionId: input.sectionId,
        prefs: {visible: input.visible},
      }),
    onSuccess: invalidateUIPreferences,
  })
}

export function useSetSidebarSortMode() {
  return useMutation({
    mutationFn: (input: {sectionId: SidebarSectionId; sortMode: 'activity' | 'alphabetical' | 'manual'}) =>
      client.uiPreferences.setSidebarSectionPrefs.mutate({
        sectionId: input.sectionId,
        prefs: {sortMode: input.sortMode},
      }),
    onSuccess: invalidateUIPreferences,
  })
}

export function useSetSidebarSectionOrder() {
  return useMutation({
    mutationFn: (input: SidebarSectionId[]) => client.uiPreferences.setSidebarSectionOrder.mutate(input),
    onSuccess: invalidateUIPreferences,
  })
}

export function useSetSidebarItemOrder() {
  return useMutation({
    mutationFn: (input: {sectionId: SidebarSectionId; itemOrder: string[]}) =>
      client.uiPreferences.setSidebarItemOrder.mutate(input),
    onSuccess: invalidateUIPreferences,
  })
}

export function useResetSidebar() {
  return useMutation({
    mutationFn: () => client.uiPreferences.resetSidebar.mutate(),
    onSuccess: invalidateUIPreferences,
  })
}
