import {templates} from '@/app-templates'
import {MainWrapper} from '@/components/main-wrapper'
import {CreateAccountBanner} from '@/components/onboarding'
import {useMarkAsRead} from '@/models/documents'

import {useExportDocuments} from '@/models/export-documents'
import {
  LibraryItem,
  LibrarySite,
  useLibrary,
  useSiteLibrary,
} from '@/models/library'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getMetadataName} from '@shm/shared/content'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMBreadcrumb,
  HMDocumentInfo,
  HMLibraryDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {DocumentRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {LibraryEntryUpdateSummary} from '@shm/ui/activity'
import {Button} from '@shm/ui/button'
import {Checkbox} from '@shm/ui/components/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {Container, PanelContainer} from '@shm/ui/container'
import {FacePile} from '@shm/ui/face-pile'
import {HMIcon} from '@shm/ui/hm-icon'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileOutput,
  ListFilter,
  MessageSquare,
  X,
} from 'lucide-react'
import {createContext, useContext, useMemo, useState} from 'react'

export default function LibraryPage() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const libraryRoute = route.key === 'library' ? route : undefined
  const displayMode = libraryRoute?.displayMode || 'subscribed'
  function setDisplayMode(mode: 'all' | 'subscribed' | 'favorites') {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      displayMode: mode,
    })
  }
  const grouping = libraryRoute?.grouping || 'site'
  const setGrouping = (grouping: 'site' | 'none') => {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      grouping,
    })
  }
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const exportDocuments = useExportDocuments()
  const library = useLibrary({
    grouping,
    displayMode,
  })
  const markAsRead = useMarkAsRead()

  // Filter out template items when in subscribed mode
  const filteredItems = library?.items?.filter((item) => {
    if (displayMode === 'subscribed') {
      const templateIds = Object.values(templates)
      if (item.type === 'site') {
        return !templateIds.includes(item.id)
      }
    }
    return true
  })

  const isLibraryEmpty = filteredItems && filteredItems.length === 0

  const [addSiteOpen, setAddSiteOpen] = useState(false)
  const menu = useMemo(() => {
    const siteMenuItems =
      library?.sites?.map((site) => {
        const id = hmId(site.id)
        return {
          key: site.id,
          label: site.hostname,
          onPress: () => {
            replace({
              key: 'document',
              id: hmId(site.id),
            })
          },
        }
      }) || []
    return {
      siteMenuItems,
    }
  }, [library?.sites, replace])

  return (
    <div className="flex h-full flex-1">
      <PanelContainer>
        <MainWrapper scrollable>
          <Container className="justify-center" centered>
            <CreateAccountBanner />
            <div className="mb-4 flex">
              <DisplayModeTab
                label="Subscribed"
                value="subscribed"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
              <DisplayModeTab
                label="Favorites"
                value="favorites"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
              <DisplayModeTab
                label="All"
                value="all"
                activeValue={displayMode}
                onDisplayMode={setDisplayMode}
              />
            </div>
            <div className="my-2 mb-4 flex justify-between">
              <div className="flex gap-2">
                <GroupingControl
                  grouping={grouping}
                  onGroupingChange={setGrouping}
                />
              </div>
              {isLibraryEmpty ? null : (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (isSelecting) {
                        exportDocuments(selectedDocIds).then((res) => {
                          setIsSelecting(false)
                          setSelectedDocIds([])
                        })
                      } else {
                        setIsSelecting(true)
                      }
                    }}
                    variant="default"
                  >
                    <FileOutput className="size-4" />
                    Export
                  </Button>
                  {isSelecting ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setIsSelecting(false)
                        setSelectedDocIds([])
                      }}
                    >
                      Cancel
                      <X className="size-4" />
                    </Button>
                  ) : null}
                  <OptionsDropdown
                    menuItems={[
                      {
                        label: 'Mark all as read',
                        key: 'mark-all-as-read',
                        icon: <CheckCheck className="size-4" />,
                        onClick: () => {
                          markAsRead(
                            library.items
                              ?.map((item) => {
                                if (item.type === 'site') {
                                  return hmId(item.id)
                                }
                                return hmId(item.account, {
                                  path: item.path,
                                })
                              })
                              .filter(
                                (id) => id !== null,
                              ) as UnpackedHypermediaId[],
                          )
                        },
                      },
                    ]}
                  />
                </div>
              )}
            </div>
            <librarySelectionContext.Provider
              value={{
                isSelecting,
                selectedDocIds,
                onSelect: (docId, isSelected) => {
                  setSelectedDocIds(
                    isSelected
                      ? [...selectedDocIds, docId]
                      : selectedDocIds.filter((id) => id !== docId),
                  )
                },
              }}
            >
              <div className="flex flex-col gap-1">
                {filteredItems?.map((item: LibraryItem) => {
                  if (item.type === 'site') {
                    return (
                      <LibrarySiteItem
                        key={item.id}
                        site={item}
                        accountsMetadata={library.accountsMetadata}
                      />
                    )
                  }
                  return (
                    <LibraryDocumentItem
                      key={`${item.account}-${item.path}`}
                      item={item}
                      accountsMetadata={library.accountsMetadata || {}}
                    />
                  )
                })}
              </div>
            </librarySelectionContext.Provider>
          </Container>
        </MainWrapper>
      </PanelContainer>
    </div>
  )
}

function DisplayModeTab({
  label,
  value,
  activeValue,
  onDisplayMode,
}: {
  label: string
  value: 'all' | 'subscribed' | 'favorites'
  activeValue: 'all' | 'subscribed' | 'favorites'
  onDisplayMode: (value: 'all' | 'subscribed' | 'favorites') => void
}) {
  return (
    <Button
      onClick={() => onDisplayMode(value)}
      variant="outline"
      className={cn(
        'hover:border-primary! hover:text-primary rounded-none border-t-0 border-r-0 border-b-3 border-l-0 border-b-transparent! bg-transparent! shadow-none hover:bg-transparent',
        activeValue === value && 'border-b-primary! text-primary',
      )}
    >
      {label}
    </Button>
  )
}

const groupingOptions: Readonly<{label: string; value: 'site' | 'none'}[]> = [
  {label: 'All Documents', value: 'none'},
  {label: 'Group by Site', value: 'site'},
] as const

function GroupingControl({
  grouping,
  onGroupingChange,
}: {
  grouping: 'site' | 'none'
  onGroupingChange: (grouping: 'site' | 'none') => void
}) {
  const popoverState = usePopoverState()
  return (
    <Popover {...popoverState}>
      <PopoverTrigger>
        <ListFilter className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="p-0" side="bottom" align="start">
        <div className="flex flex-col">
          {groupingOptions.map((option) => (
            <Button
              onClick={() => onGroupingChange(option.value)}
              key={option.value}
              variant="ghost"
              className="justify-start border-none"
            >
              {grouping === option.value ? (
                <Check className="text-primary size-4" />
              ) : (
                <div className="size-4" />
              )}
              {option.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const librarySelectionContext = createContext<{
  isSelecting: boolean
  selectedDocIds: string[]
  onSelect: (id: string, isSelected: boolean) => void
}>({
  isSelecting: false,
  selectedDocIds: [],
  onSelect: () => {},
})

function SelectionCollapseButton({
  isCollapsed,
  setIsCollapsed,
  docId,
  isSelecting = false,
  isSelected,
  onSelect,
}: {
  isCollapsed: boolean | null
  setIsCollapsed?: (isCollapsed: boolean) => void
  docId: string
  isSelecting: boolean
  isSelected: boolean
  onSelect: (docId: string, isSelected: boolean) => void
}) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center">
      {isSelecting ? (
        <Checkbox
          variant="primary"
          size="lg"
          className="border-primary border"
          checked={isSelected}
          onCheckedChange={(isSelected: boolean) => onSelect(docId, isSelected)}
          onClick={(e) => {
            e.stopPropagation()
          }}
        />
      ) : isCollapsed === null ? null : (
        <Button
          variant="ghost"
          size="iconSm"
          className="size-6 hover:bg-black/10 dark:hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation()
            setIsCollapsed?.(!isCollapsed)
          }}
        >
          {isCollapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      )}
    </div>
  )
}

function LibrarySiteItem({
  site,
  accountsMetadata,
}: {
  site: LibrarySite
  accountsMetadata?: HMAccountsMetadata
}) {
  const route = useNavRoute()
  const {isSelecting, selectedDocIds, onSelect} = useContext(
    librarySelectionContext,
  )

  const libraryRoute = route.key === 'library' ? route : undefined
  const replace = useNavigate('replace')
  const expandedIds =
    (route.key === 'library' ? route.expandedIds : undefined) || []
  const isCollapsed = !expandedIds.includes(site.id)
  function setIsCollapsed(isCollapsed: boolean) {
    replace({
      key: 'library',
      ...(libraryRoute || {}),
      expandedIds: isCollapsed
        ? expandedIds?.filter((id) => id !== site.id)
        : [...expandedIds, site.id],
    })
  }
  const navigate = useNavigate()
  const metadata = site?.metadata
  const id = hmId(site.id)
  const isSelected = selectedDocIds.includes(id.id)
  const documents = useSiteLibrary(site.id, !isCollapsed)
  const homeDocument = documents.data?.find((doc) => !doc.path?.length)
  const siteDisplayActivitySummary =
    !isCollapsed && homeDocument
      ? homeDocument.activitySummary
      : site.activitySummary
  const latestComment = isCollapsed
    ? site.latestComment
    : homeDocument?.latestComment
  const isRead = !siteDisplayActivitySummary?.isUnread
  return (
    <>
      <Button
        data-docid={id.id}
        variant="ghost"
        className={cn(
          'h-auto! items-center gap-2 border-none bg-transparent px-4 py-2',
          // isRead && 'bg-muted',
        )}
        onClick={() => {
          if (isSelecting) {
            onSelect(id.id, !isSelected)
          } else {
            navigate({key: 'document', id})
          }
        }}

        // this data attribute is used by the hypermedia highlight component
      >
        <SelectionCollapseButton
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          docId={id.id}
          isSelecting={isSelecting}
          isSelected={isSelected}
          onSelect={onSelect}
        />
        <HMIcon id={id} metadata={metadata} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="items-center-justify-start flex flex-1 overflow-hidden">
              <SizableText
                className={cn(
                  'flex-1 truncate overflow-hidden text-left',
                  isRead ? undefined : 'font-bold',
                )}
              >
                {getMetadataName(metadata)}
              </SizableText>
            </div>
            {siteDisplayActivitySummary && (
              <LibraryEntryCommentCount
                activitySummary={siteDisplayActivitySummary}
              />
            )}
          </div>
          {siteDisplayActivitySummary && (
            <LibraryEntryUpdateSummary
              accountsMetadata={accountsMetadata}
              latestComment={latestComment}
              activitySummary={siteDisplayActivitySummary}
            />
          )}
        </div>
      </Button>
      {isCollapsed ? null : (
        <div className="mb-4 flex flex-col gap-1">
          {documents.data?.map((item) => {
            if (item.path?.length === 0) return null
            return (
              <LibraryDocumentItem
                key={item.path?.join('/') || ''}
                item={item}
                accountsMetadata={accountsMetadata || {}}
              />
            )
          })}
        </div>
      )}
    </>
  )
}

export function LibraryDocumentItem({
  item,
  indent,
  accountsMetadata,
}: {
  item: HMLibraryDocument
  indent?: boolean
  accountsMetadata: HMAccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const id = hmId(item.account, {
    path: item.path,
  })
  const {isSelecting, selectedDocIds, onSelect} = useContext(
    librarySelectionContext,
  )
  const isSelected = selectedDocIds.includes(id.id)
  const isRead = !item.activitySummary?.isUnread
  return (
    <Button
      // this data attribute is used by the hypermedia highlight component
      data-docid={id.id}
      variant="ghost"
      className={cn(
        'h-auto! w-full items-center justify-start border-none bg-transparent px-4 py-2',
        // isRead && 'bg-muted',
      )}
      onClick={() => {
        if (isSelecting) {
          onSelect(id.id, !isSelected)
        } else {
          navigate({key: 'document', id})
        }
      }}
    >
      <SelectionCollapseButton
        isCollapsed={null}
        docId={id.id}
        isSelecting={isSelecting}
        isSelected={isSelected}
        onSelect={onSelect}
      />
      <div className="size-8 shrink-0" />

      <div className="flex flex-1 flex-col overflow-hidden">
        <LibraryEntryBreadcrumbs
          breadcrumbs={item.breadcrumbs}
          onNavigate={navigate}
          id={id}
        />
        <div className="flex flex-1 items-center gap-3">
          <div className="items-center-justify-start flex flex-1 overflow-hidden">
            <SizableText
              className={cn('flex-1 truncate text-left')}
              weight={isRead ? undefined : 'bold'}
            >
              {getMetadataName(metadata)}
            </SizableText>
          </div>
          {item.activitySummary && (
            <LibraryEntryCommentCount activitySummary={item.activitySummary} />
          )}
          <LibraryEntryAuthors
            item={item}
            accountsMetadata={accountsMetadata}
          />
        </div>
        {item.activitySummary && (
          <LibraryEntryUpdateSummary
            accountsMetadata={accountsMetadata}
            latestComment={item.latestComment}
            activitySummary={item.activitySummary}
          />
        )}
      </div>
    </Button>
  )
}

function LibraryEntryBreadcrumbs({
  breadcrumbs,
  onNavigate,
  id,
}: {
  breadcrumbs: HMBreadcrumb[]
  onNavigate: (route: DocumentRoute) => void
  id: UnpackedHypermediaId
}) {
  const displayCrumbs = breadcrumbs.slice(1).filter((crumb) => !!crumb.name)
  if (!displayCrumbs.length) return null
  return (
    <div className="flex">
      {displayCrumbs.map((breadcrumb, idx) => (
        <>
          <Button
            key={breadcrumb.name}
            variant="link"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate({
                key: 'document',
                id: {...id, path: entityQueryPathToHmIdPath(breadcrumb.path)},
              })
            }}
          >
            {breadcrumb.name}
          </Button>
          {idx === displayCrumbs.length - 1 ? null : (
            <SizableText
              key={`separator-${idx}`}
              className="text-muted-foreground text-sm"
            >
              /
            </SizableText>
          )}
        </>
      ))}
    </div>
  )
}

function LibraryEntryCommentCount({
  activitySummary,
}: {
  activitySummary: HMActivitySummary
}) {
  const commentCount = activitySummary?.commentCount
  if (!commentCount) return null
  return (
    <div className="flex items-center gap-1">
      <MessageSquare size={16} />
      <SizableText size="sm">{commentCount}</SizableText>
    </div>
  )
}

function LibraryEntryAuthors({
  item,
  accountsMetadata,
}: {
  item: HMDocumentInfo
  accountsMetadata: HMAccountsMetadata
}) {
  const {authors} = item
  return <FacePile accounts={authors} accountsMetadata={accountsMetadata} />
  // return <XStack>{authors.map((author) => <LinkIcon id={author.id} metadata={author.metadata} size={16} />)}</XStack>
}
