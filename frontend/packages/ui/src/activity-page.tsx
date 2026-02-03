import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Clock} from 'lucide-react'
import {ReactNode, Ref} from 'react'
import {Feed} from './feed'
import {OpenInPanelButton} from './open-in-panel'
import {PageLayout} from './page-layout'
import {SizableText} from './text'
import {useScrollRestoration} from './use-scroll-restoration'

export interface ActivityPageContentProps {
  docId: UnpackedHypermediaId
  filterEventType?: string[]
  currentAccountId?: string
  commentEditor?: ReactNode
  /** External scroll ref for scroll restoration */
  scrollRef?: Ref<HTMLDivElement>
  /** Whether to show the "Open in Panel" button. Defaults to true. */
  showOpenInPanel?: boolean
  /** Whether to show the title. Defaults to true. */
  showTitle?: boolean
  /** Custom max width for centered content */
  contentMaxWidth?: number
  /** Feed size variant */
  size?: 'sm' | 'md'
}

/**
 * Full-page activity feed content component.
 * Can be used standalone (page) or the underlying components reused in panel.
 */
export function ActivityPageContent({
  docId,
  filterEventType = [],
  currentAccountId,
  scrollRef: externalScrollRef,
  showOpenInPanel = true,
  showTitle = true,
  contentMaxWidth,
  size = 'md',
}: ActivityPageContentProps) {
  const route = useNavRoute()

  // Use external scroll ref if provided, otherwise create internal one
  const internalScrollRef = useScrollRestoration({
    scrollId: `activity-page-${docId.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })
  const scrollRef = externalScrollRef || internalScrollRef

  return (
    <PageLayout
      title={showTitle ? 'Activity' : undefined}
      centered
      contentMaxWidth={contentMaxWidth}
      scrollRef={scrollRef}
      headerRight={
        showOpenInPanel ? (
          <OpenInPanelButton
            id={docId}
            panelRoute={{key: 'activity', id: docId}}
          />
        ) : undefined
      }
    >
      <Feed
        size={size}
        centered
        filterResource={docId.id}
        currentAccount={currentAccountId || ''}
        filterEventType={filterEventType}
      />
    </PageLayout>
  )
}

export function ActivityEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Clock className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        No activity yet
      </SizableText>
      <SizableText color="muted" size="sm">
        Activity will appear here when there are changes
      </SizableText>
    </div>
  )
}
