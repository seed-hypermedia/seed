import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, ListAccountsRequest, useRouteLink, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {IS_DESKTOP} from '@shm/shared/constants'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useAccounts, useDirectory, useSelectedAccountId} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'
import {Check, ChevronsUpDown, Search} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {focusExploreSearch} from './explore-search-focus'
import {HMIcon} from './hm-icon'
import {SiteFileBrowser, type SiteFileBrowserProps} from './site-file-browser'
import {useNavRouteOrNull} from '@shm/shared/utils/navigation'
import {cn} from './utils'

/** Shared sidebar content for web and desktop; platform shells own its size and visibility. */
export function SiteSidebar({
  siteId,
  ownSiteUids = [],
  unreadNotificationsBySite = {},
  onNavigate,
  onAfterNavigate,
  explore,
  children,
}: {
  siteId: UnpackedHypermediaId
  ownSiteUids?: string[]
  unreadNotificationsBySite?: Record<string, number>
  onNavigate: (id: UnpackedHypermediaId) => void
  onAfterNavigate?: () => void
  explore?: ReactNode
  children: ReactNode
}) {
  const {isGateway} = useUniversalAppContext()
  const accountUid = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const siteUids = Array.from(
    new Set([
      siteId.uid,
      ...(accountUid
        ? [
            accountUid,
            ...ownSiteUids,
            ...(contacts.data?.filter((contact) => contact.subscribe?.site).map((contact) => contact.subject) ?? []),
          ]
        : []),
    ]),
  )
  const client = useUniversalClient()
  const activityOrder = useQuery({
    queryKey: [queryKeys.LIST_ACCOUNTS, 'sidebar-activity-order'],
    enabled: (IS_DESKTOP || isGateway) && !!accountUid && !!client.listAccounts,
    queryFn: async () => {
      const uids: string[] = []
      let pageToken = ''
      do {
        const response = await client.listAccounts!(new ListAccountsRequest({pageSize: 1000, pageToken}))
        uids.push(...response.accounts.map((account) => account.id))
        pageToken = response.nextPageToken
      } while (pageToken)
      return uids
    },
    refetchInterval: 15_000,
  })
  const activityRanks = new Map(activityOrder.data?.map((uid, index) => [uid, index]))
  const accounts = useAccounts(siteUids)
  const sites = siteUids.map((uid, index) => ({uid, metadata: accounts[index]?.data?.metadata}))
  sites.sort(
    (a, b) =>
      (activityRanks.get(a.uid) ?? Number.MAX_SAFE_INTEGER) - (activityRanks.get(b.uid) ?? Number.MAX_SAFE_INTEGER),
  )
  const current = accounts[0]?.data
  const directory = useDirectory(siteId, {mode: 'AllDescendants'})
  const route = useNavRouteOrNull()
  const exploreLink = useRouteLink(
    {key: 'explore', context: {type: 'site', id: siteId}},
    {
      onClick: () => {
        focusExploreSearch()
        onAfterNavigate?.()
      },
    },
  )
  return (
    <aside aria-label="Site sidebar" className="bg-background text-sidebar-foreground flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 flex-col gap-3.5 border-b px-2 py-4">
        {explore ?? (
          <Button
            asChild
            variant="ghost"
            className={cn(
              'h-10 w-full justify-start gap-3 rounded-xl px-3 text-sm font-semibold',
              route?.key === 'explore' &&
                'bg-sidebar-accent text-brand hover:bg-sidebar-accent/80 hover:text-brand dark:text-sidebar-accent-foreground dark:hover:bg-sidebar-accent/80 dark:hover:text-sidebar-accent-foreground',
            )}
          >
            <a {...exploreLink} aria-current={route?.key === 'explore' ? 'page' : undefined}>
              <Search className="size-4" />
              Explore
            </a>
          </Button>
        )}
        {(IS_DESKTOP || isGateway) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                aria-label="Select site"
                className="bg-card border-border hover:bg-card/80 text-card-foreground h-15 w-full justify-start gap-3 rounded-xl px-3 py-2 shadow-xs"
              >
                <HMIcon id={siteId} name={current?.metadata?.name} icon={current?.metadata?.icon} size={36} />
                <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                  <span className="w-full truncate text-sm font-semibold">
                    {current?.metadata?.name || 'Current site'}
                  </span>
                  {directory.data && (
                    <span className="text-icon text-xs font-normal">
                      {directory.data.length} {directory.data.length === 1 ? 'document' : 'documents'}
                    </span>
                  )}
                </span>
                <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
              {sites.map(({uid, metadata}) => {
                const unreadCount = accountUid ? unreadNotificationsBySite[uid] ?? 0 : 0
                return (
                  <DropdownMenuItem
                    key={uid}
                    aria-current={uid === siteId.uid ? 'true' : undefined}
                    onSelect={() => {
                      onNavigate(hmId(uid))
                      onAfterNavigate?.()
                    }}
                  >
                    <HMIcon id={hmId(uid)} name={metadata?.name} icon={metadata?.icon} size={24} />
                    <span className="min-w-0 flex-1 truncate">
                      {metadata?.name || (uid === siteId.uid ? 'Current site' : 'Untitled site')}
                    </span>
                    {uid === siteId.uid && <Check aria-hidden="true" className="size-4 shrink-0" />}
                    {unreadCount > 0 && (
                      <>
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-red-500" />
                        <span className="sr-only">{unreadCount} unread notifications</span>
                      </>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  )
}

/** File browser and filtering tools, shared by the sidebar's page and fallback content. */
export function SiteSidebarDocuments(props: SiteFileBrowserProps) {
  const route = useNavRouteOrNull()
  const [searchVisible, setSearchVisible] = useState(false)
  return (
    <SiteFileBrowser
      {...props}
      key={props.siteId.uid}
      activeDocumentId={route?.key === 'explore' ? null : props.activeDocumentId}
      showHeader
      searchVisible={searchVisible}
      onSearchVisibleChange={setSearchVisible}
    />
  )
}
