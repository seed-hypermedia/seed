import {PanelSelectionOptions} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {X} from 'lucide-react'
import {useRef, useState} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Button} from './button'
import {FeedFilters} from './feed-filters'
import {Text} from './text'
import {cn} from './utils'

const DEFAULT_PANEL_PX = 440
const MAX_OPEN_PERCENT = 30
const MAX_PANEL_PERCENT = 50
const MIN_PANEL_PERCENT = 20
const MIN_PANEL_PX = 250

/**
 * The panel's minimum size as a percentage of its container. Keeps the panel at least
 * MIN_PANEL_PX wide, without exceeding the largest size a panel may take.
 */
export function getPanelMinPercent(containerWidth: number) {
  if (!containerWidth) return MIN_PANEL_PERCENT
  return Math.min(MAX_PANEL_PERCENT, Math.max(MIN_PANEL_PERCENT, (MIN_PANEL_PX / containerWidth) * 100))
}

export interface PanelLayoutProps {
  children: React.ReactNode
  panelContent: React.ReactNode | null
  panelKey: PanelSelectionOptions | null
  onPanelClose: () => void
  /** True when the activity panel is being used as the shared versions panel. */
  isVersionsPanel?: boolean
  /** True when the activity panel is scoped to one block's citations. */
  isCitationsPanel?: boolean
  /** For activity panel: current filter state */
  filterEventType?: string[]
  /** For activity panel: filter change handler */
  onFilterChange?: (filter: {filterEventType?: string[]}) => void
  /** Storage for panel width persistence (desktop uses nav state, web uses localStorage) */
  widthStorage?: {
    getItem: (name: string) => string
    setItem: (name: string, value: string) => void
  }
  /** Current panel width percentage (for controlled mode) */
  panelWidth?: number
  /** Callback when panel width changes */
  onPanelWidthChange?: (width: number) => void
  /** Replaces the default header, for panels with their own controls. */
  header?: React.ReactNode
}

function getPanelTitle(panelKey: PanelSelectionOptions | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Document Activity'
    case 'comments':
      return 'Discussions'
    case 'directory':
      return 'Sub documents'
    case 'collaborators':
      return 'Collaborators'
    case 'options':
      return 'Draft Options'
    case 'metadata':
      return 'Attributes'
    case 'feed':
      return 'Activity'
    default:
      return ''
  }
}

/** Resolves the title and filter visibility for a document side panel. */
export function getPanelHeaderState(
  panelKey: PanelSelectionOptions | null,
  isVersionsPanel: boolean,
  isCitationsPanel: boolean,
): {title: string; showActivityFilters: boolean} {
  return {
    title: isVersionsPanel ? 'Versions history' : isCitationsPanel ? 'Citations' : getPanelTitle(panelKey),
    showActivityFilters: panelKey === 'activity' && !isVersionsPanel && !isCitationsPanel,
  }
}

export function PanelLayout({
  children,
  panelContent,
  panelKey,
  onPanelClose,
  isVersionsPanel = false,
  isCitationsPanel = false,
  filterEventType,
  onFilterChange,
  widthStorage,
  panelWidth,
  onPanelWidthChange,
  header,
}: PanelLayoutProps) {
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accessoryPanelRef = useRef<ImperativePanelHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevPanelKey = useRef<PanelSelectionOptions | null>(panelKey)
  const [containerWidth, setContainerWidth] = useState(0)
  const minPanelPercent = getPanelMinPercent(containerWidth)

  // The minimum is a fixed pixel width, so its percentage follows the container as the window resizes.
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry?.contentRect.width ?? 0))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Always open panel at DEFAULT_PANEL_PX, capped at MAX_OPEN_PERCENT but never below the minimum width
  useIsomorphicLayoutEffect(() => {
    const isOpening = prevPanelKey.current === null && panelKey !== null

    if (isOpening) {
      const container = containerRef.current
      if (container) {
        const containerWidth = container.getBoundingClientRect().width
        if (containerWidth) {
          const targetPercent = Math.max(
            getPanelMinPercent(containerWidth),
            Math.min(MAX_OPEN_PERCENT, (DEFAULT_PANEL_PX / containerWidth) * 100),
          )
          accessoryPanelRef.current?.resize(targetPercent)
          onPanelWidthChange?.(targetPercent)
        }
      }
    }

    prevPanelKey.current = panelKey
  }, [panelKey, onPanelWidthChange])

  const {title, showActivityFilters} = getPanelHeaderState(panelKey, isVersionsPanel, isCitationsPanel)

  return (
    <div ref={containerRef} className="flex h-full flex-1">
      <PanelGroup
        direction="horizontal"
        ref={panelsRef}
        style={{flex: 1}}
        autoSaveId="resource-panel"
        storage={widthStorage}
      >
        <Panel id="main" minSize={100 - MAX_PANEL_PERCENT}>
          <div className="relative h-full rounded-lg">{children}</div>
        </Panel>

        {panelKey !== null && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel
              id="accessory"
              ref={accessoryPanelRef}
              maxSize={MAX_PANEL_PERCENT}
              minSize={minPanelPercent}
              defaultSize={Math.max(panelWidth || 0, minPanelPercent)}
              onResize={onPanelWidthChange}
              className="border-l"
            >
              <div className="h-full rounded-lg">
                <div className={cn('dark:bg-background flex h-full flex-col bg-white')}>
                  <div className="border-border border-b px-5 py-3">
                    {header ?? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <Text weight="semibold" size="lg" className="flex-1">
                            {title}
                          </Text>
                          <Button size="icon" onClick={onPanelClose}>
                            <X className="size-4" />
                          </Button>
                        </div>
                        {showActivityFilters && onFilterChange && (
                          <FeedFilters filterEventType={filterEventType} onFilterChange={onFilterChange} />
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden">{panelContent}</div>
                </div>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
