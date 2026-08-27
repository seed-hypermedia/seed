import {useBookmarks, useRemoveBookmark, type BookmarkItem} from '@/models/bookmarks'
import {useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResources} from '@shm/shared/models/entity'
import {createDocumentNavRoute, type ProfileTab} from '@shm/shared/routes'
import {hmId, viewTermToRouteKey, type ViewTerm} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {HMIcon} from '@shm/ui/hm-icon'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
  AlertCircle,
  Bookmark,
  FileText,
  Folder,
  History,
  Lock,
  MessageSquare,
  MessagesSquare,
  Quote,
  User,
  Users,
  X,
} from 'lucide-react'
import React, {useState} from 'react'

/** Return a copy of the stored bookmark list ordered from newest to oldest. */
export function newestBookmarksFirst<T>(bookmarks: readonly T[]): T[] {
  return [...bookmarks].reverse()
}

const VIEW_TERM_ICONS: Record<string, React.ElementType> = {
  ':content': FileText,
  ':comments': MessagesSquare,
  ':activity': Quote,
  ':collaborators': Users,
  ':directory': Folder,
  ':feed': History,
}

function profileTabFromViewTerm(viewTerm: ViewTerm | null): ProfileTab {
  switch (viewTerm) {
    case ':membership':
      return 'membership'
    case ':followers':
      return 'followers'
    case ':following':
      return 'following'
    default:
      return 'profile'
  }
}

/** Build the navigation destination for a persisted bookmark. */
export function bookmarkRoute(bookmark: BookmarkItem) {
  if (bookmark.key === 'comment') {
    return {key: 'comments' as const, id: bookmark.targetId, openComment: bookmark.commentId}
  }
  if (bookmark.key === 'profile') {
    return {key: 'profile' as const, id: bookmark.id, tab: profileTabFromViewTerm(bookmark.viewTerm)}
  }
  return bookmark.viewTerm
    ? createDocumentNavRoute(bookmark.id, viewTermToRouteKey(bookmark.viewTerm))
    : {key: 'document' as const, id: bookmark.id}
}

/** Titlebar control and popover for navigating and removing saved bookmarks. */
export function BookmarksPopover() {
  const [open, setOpen] = useState(false)
  const bookmarks = newestBookmarksFirst(useBookmarks())
  const bookmarkEntities = useResources(
    bookmarks.map((bookmark) => (bookmark.key === 'comment' ? hmId(bookmark.authorAccountId) : bookmark.id)),
  )
  const contacts = useSelectedAccountContacts()
  const removeBookmark = useRemoveBookmark()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Bookmarks" asChild>
        <PopoverTrigger asChild>
          <Button
            aria-label="Bookmarks"
            aria-expanded={open}
            className={cn(
              'window-no-drag h-8 w-8 rounded-full border p-0',
              open
                ? 'border-black/15 bg-black/10 shadow-xs hover:border-black/20 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/20 dark:hover:bg-white/15'
                : 'border-transparent',
            )}
          >
            <Bookmark className="size-4" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-screen max-w-none overflow-hidden rounded-xl border border-black/8 bg-white p-0 shadow-xl sm:w-[360px] sm:max-w-[360px] dark:border-white/10 dark:bg-black"
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <h2 className="text-lg font-semibold">Bookmarks</h2>
          <span className="text-muted-foreground text-sm font-medium tabular-nums">{bookmarks.length}</span>
        </div>
        {bookmarks.length ? (
          <div className="max-h-[75vh] overflow-y-auto sm:max-h-[50vh]">
            {bookmarks.map((bookmark, index) => {
              const entity = bookmarkEntities[index]
              const deleting = removeBookmark.isLoading && removeBookmark.variables === bookmark.url

              if (bookmark.key === 'comment') {
                const authorId = hmId(bookmark.authorAccountId)
                const authorMetadata = getContactMetadata(
                  bookmark.authorAccountId,
                  entity?.data?.type === 'document' ? entity.data.document?.metadata : undefined,
                  contacts.data,
                )
                return (
                  <BookmarkRow
                    key={bookmark.url}
                    bookmark={bookmark}
                    title={bookmark.title}
                    leading={
                      <span className="relative size-8 shrink-0">
                        <HMIcon id={authorId} name={authorMetadata.name} icon={authorMetadata.icon} size={32} />
                        <span className="bg-background ring-background absolute -right-1 -bottom-1 z-10 flex size-4 items-center justify-center rounded-full ring-2">
                          <MessageSquare className="text-foreground size-3" />
                        </span>
                      </span>
                    }
                    deleting={deleting}
                    onRemove={() => removeBookmark.mutate(bookmark.url)}
                    onNavigate={() => setOpen(false)}
                  />
                )
              }

              if (!entity?.data || entity.data.type !== 'document') {
                if (entity?.isLoading) return null
                return (
                  <BookmarkRow
                    key={bookmark.url}
                    bookmark={bookmark}
                    title="Error"
                    titleClassName="text-destructive"
                    icon={AlertCircle}
                    deleting={deleting}
                    onRemove={() => removeBookmark.mutate(bookmark.url)}
                    onNavigate={() => setOpen(false)}
                  />
                )
              }

              const {id, document} = entity.data
              const metadata = id.path?.length
                ? document?.metadata
                : getContactMetadata(id.uid, document?.metadata, contacts.data)

              return (
                <BookmarkRow
                  key={bookmark.url}
                  bookmark={bookmark}
                  title={metadata?.name || 'Untitled'}
                  privateDocument={document?.visibility === 'PRIVATE'}
                  deleting={deleting}
                  onRemove={() => removeBookmark.mutate(bookmark.url)}
                  onNavigate={() => setOpen(false)}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="bg-muted/50 text-muted-foreground mb-5 flex size-14 items-center justify-center rounded-2xl border">
              <Bookmark className="size-6" />
            </div>
            <p className="text-base font-semibold">No bookmarks yet</p>
            <p className="text-muted-foreground mt-2 max-w-64 text-sm leading-relaxed">
              Bookmark documents, profiles, and views to find them quickly here.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function BookmarkRow({
  bookmark,
  title,
  titleClassName,
  icon: Icon,
  leading,
  privateDocument,
  deleting,
  onRemove,
  onNavigate,
}: {
  bookmark: BookmarkItem
  title: string
  titleClassName?: string
  icon?: React.ElementType
  leading?: React.ReactNode
  privateDocument?: boolean
  deleting: boolean
  onRemove: () => void
  onNavigate: () => void
}) {
  const route = bookmarkRoute(bookmark)
  const linkProps = useRouteLink(route)
  const LeadingIcon =
    Icon ||
    (bookmark.viewTerm ? VIEW_TERM_ICONS[bookmark.viewTerm] : null) ||
    (bookmark.key === 'profile' ? User : FileText)

  const navigate = (event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    linkProps.onClick?.(event as React.MouseEvent<HTMLDivElement>)
    onNavigate()
  }

  return (
    <div
      role="link"
      tabIndex={0}
      className="group hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-ring flex min-h-12 cursor-pointer items-center gap-3 border-b px-4 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
      onClick={navigate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(event)
        }
      }}
    >
      {leading || (
        <span className="bg-muted-foreground/15 text-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
          <LeadingIcon className="size-4" />
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', titleClassName)} title={title}>
        {title}
      </span>
      {privateDocument ? <Lock className="text-muted-foreground size-3.5 shrink-0" /> : null}
      <Tooltip content="Remove from Bookmarks">
        <Button
          aria-label={`Remove ${title} from Bookmarks`}
          disabled={deleting}
          className="size-8 shrink-0 rounded-lg bg-transparent p-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-4" />
        </Button>
      </Tooltip>
    </div>
  )
}
