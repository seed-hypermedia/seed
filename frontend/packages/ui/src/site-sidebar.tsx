import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, ListAccountsRequest, useRouteLink, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {IS_DESKTOP} from '@shm/shared/constants'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useAccount, useAccounts, useDirectory, useSelectedAccountId} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'
import {ChevronsUpDown, Search} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {Button} from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {focusExploreSearch} from './explore-search-focus'
import {HMIcon} from './hm-icon'
import {SiteFileBrowser, type SiteFileBrowserProps} from './site-file-browser'
import {useNavRouteOrNull} from '@shm/shared/utils/navigation'
import {cn} from './utils'

/** Shared sidebar content for web and desktop; platform shells own its size and visibility. */
export function SiteSidebar({
  siteId,
  unreadNotificationsBySite = {},
  siteSelectorModal = false,
  onNavigate,
  onAfterNavigate,
  explore,
  children,
}: {
  siteId: UnpackedHypermediaId
  unreadNotificationsBySite?: Record<string, number>
  /** Keeps the portaled menu scrollable inside the mobile sidebar's modal dialog. */
  siteSelectorModal?: boolean
  onNavigate: (id: UnpackedHypermediaId) => void
  onAfterNavigate?: () => void
  explore?: ReactNode
  children: ReactNode
}) {
  const {isGateway} = useUniversalAppContext()
  const accountUid = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const siteUids = Array.from(
    new Set(
      accountUid
        ? [
            accountUid,
            ...(contacts.data?.filter((contact) => contact.subscribe?.site).map((contact) => contact.subject) ?? []),
          ]
        : [],
    ),
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
  const ownSite = sites.find((site) => site.uid === accountUid)
  const joinedSites = sites.filter((site) => site.uid !== accountUid)
  const renderSiteItem = ({uid, metadata}: (typeof sites)[number], isOwn: boolean) => {
    const unreadCount = accountUid ? unreadNotificationsBySite[uid] ?? 0 : 0
    const isCurrent = uid === siteId.uid
    return (
      <DropdownMenuItem
        key={uid}
        aria-current={isCurrent ? 'true' : undefined}
        className={cn(
          'gap-3 rounded-lg px-2 font-semibold',
          isOwn ? 'py-2' : 'py-1.5',
          isCurrent && 'bg-sidebar-accent focus:bg-sidebar-accent/80',
        )}
        onSelect={() => {
          onNavigate(hmId(uid))
          onAfterNavigate?.()
        }}
      >
        <HMIcon id={hmId(uid)} name={metadata?.name} icon={metadata?.icon} size={isOwn ? 40 : 24} />
        <span className="min-w-0 flex-1 truncate">
          {metadata?.name || (isCurrent ? 'Current site' : 'Untitled site')}
        </span>
        {unreadCount > 0 && (
          <>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-red-500" />
            <span className="sr-only">{unreadCount} unread notifications</span>
          </>
        )}
      </DropdownMenuItem>
    )
  }
  const current = useAccount(siteId.uid).data
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
      <div className="flex shrink-0 flex-col px-2 py-4">
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
          <div className="mt-8 flex flex-col gap-2">
            <span className="text-icon px-1 text-xs font-semibold tracking-wide uppercase">Spaces</span>
            <DropdownMenu modal={siteSelectorModal}>
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
              <DropdownMenuContent
                align="start"
                className="max-h-96 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto p-1.5"
              >
                {ownSite && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold">
                      My Space
                    </DropdownMenuLabel>
                    {renderSiteItem(ownSite, true)}
                  </DropdownMenuGroup>
                )}
                {joinedSites.length > 0 && (
                  <DropdownMenuGroup className={ownSite ? 'mt-3' : undefined}>
                    <DropdownMenuLabel className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold">
                      Joined Spaces
                    </DropdownMenuLabel>
                    {joinedSites.map((site) => renderSiteItem(site, false))}
                  </DropdownMenuGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
