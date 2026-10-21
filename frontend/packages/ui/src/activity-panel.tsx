import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {IS_DESKTOP} from '@shm/shared/constants'
import type {ActivityTab} from '@shm/shared/routes'
import {useNavigate, useNavigationDispatch, useNavigationState} from '@shm/shared/utils/navigation'
import {AtSign, Clock, Maximize2, Minimize2, X} from 'lucide-react'
import {type ComponentType, createContext, useCallback, useContext} from 'react'
import {Button} from './button'
import {ActivityEventCard, ALL_UPDATES_EVENT_TYPES} from './activity-event-card'
import {Feed, getActivityEventRoute} from './feed'
import {Text} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Platform component rendering the To you tab for one space. Desktop and web load notifications differently,
 * so each platform supplies its own.
 */
export type NotificationInboxComponent = ComponentType<{spaceUid: string}>

const NotificationInboxContext = createContext<NotificationInboxComponent | null>(null)

/** Supplies the platform's To you component to the Activity panel and the full Activity page. */
export const NotificationInboxProvider = NotificationInboxContext.Provider

const activityTabs: Array<{value: ActivityTab; label: string; Icon: typeof AtSign}> = [
  {value: 'to-you', label: 'To you', Icon: AtSign},
  {value: 'all-updates', label: 'All updates', Icon: Clock},
]

/** Header of the space Activity view. */
export function ActivityHeader({
  tab,
  onTabChange,
  onExpand,
  onCollapse,
  onClose,
}: {
  tab: ActivityTab | undefined
  onTabChange: (tab: ActivityTab) => void
  onExpand?: () => void
  onCollapse?: () => void
  onClose?: () => void
}) {
  const activeTab = tab ?? 'all-updates'
  return (
    // From tablet width up the buttons stay pinned top-right, and on a narrow panel only the tabs wrap, under the title.
    // On phones they follow the tabs, clear of the page's own options menu in the corner.
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:flex-1">
        <Text weight="semibold" size="lg">
          Activity
        </Text>
        <div className="flex items-center gap-1" role="tablist" aria-label="Activity">
          {activityTabs.map(({value, label, Icon}) => (
            <Button
              key={value}
              size="sm"
              variant="outline"
              role="tab"
              aria-selected={activeTab === value}
              className={cn('rounded-full', activeTab === value && 'border-brand bg-brand-12 text-brand-4')}
              onClick={() => onTabChange(value)}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onExpand ? (
          <Tooltip content="Expand">
            <Button size="icon" variant="ghost" aria-label="Expand Activity" onClick={onExpand}>
              <Maximize2 className="size-4" />
            </Button>
          </Tooltip>
        ) : null}
        {onCollapse ? (
          <Tooltip content="Collapse">
            <Button size="icon" variant="ghost" aria-label="Collapse Activity" onClick={onCollapse}>
              <Minimize2 className="size-4" />
            </Button>
          </Tooltip>
        ) : null}
        {onClose ? (
          <Button size="icon" variant="ghost" aria-label="Close Activity" onClick={onClose}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Body of the space Activity view for the selected tab. */
export function ActivityContent({
  spaceId,
  tab,
  targetDomain,
  size = 'sm',
}: {
  spaceId: UnpackedHypermediaId
  tab: ActivityTab | undefined
  targetDomain?: string
  size?: 'sm' | 'md'
}) {
  const Inbox = useContext(NotificationInboxContext)
  if (tab === 'to-you') return Inbox ? <Inbox spaceUid={spaceId.uid} /> : null
  return (
    <Feed
      filterResource={`${spaceId.id}*`}
      filterEventType={ALL_UPDATES_EVENT_TYPES}
      targetDomain={targetDomain}
      size={size}
      routeForEvent={getActivityEventRoute}
      EventCard={ActivityEventCard}
    />
  )
}

/**
 * Collapses the full Activity page back into the side panel by going back to the page it was expanded from, which
 * still has the panel open. Without a previous page, it opens the space home document with the panel.
 */
export function useCollapseActivity(spaceId: UnpackedHypermediaId, tab: ActivityTab | undefined) {
  const routeIndex = useNavigationState()?.routeIndex ?? 0
  const dispatch = useNavigationDispatch()
  const replace = useNavigate('replace')
  return useCallback(() => {
    if (IS_DESKTOP) {
      if (routeIndex > 0) {
        dispatch({type: 'pop'})
        return
      }
    } else if ((window.history.state?.idx ?? 0) > 0) {
      window.history.back()
      return
    }
    replace({key: 'document', id: spaceId, panel: {key: 'feed', id: spaceId, tab}})
  }, [routeIndex, dispatch, replace, spaceId, tab])
}
