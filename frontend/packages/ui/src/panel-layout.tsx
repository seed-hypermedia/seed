import {PanelSelectionOptions} from '@shm/shared'
import {X} from 'lucide-react'
import {useLayoutEffect, useRef} from 'react'
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

export interface PanelLayoutProps {
  children: React.ReactNode
  panelContent: React.ReactNode | null
  panelKey: PanelSelectionOptions | null
  onPanelClose: () => void
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
}

function getPanelTitle(panelKey: PanelSelectionOptions | null): string {
  switch (panelKey) {
    case 'activity':
      return 'Document Activity'
    case 'discussions':
      return 'Discussions'
    case 'directory':
      return 'Directory'
    case 'collaborators':
      return 'Collaborators'
    case 'options':
      return 'Draft Options'
    default:
      return ''
  }
}

export function PanelLayout({
  children,
  panelContent,
  panelKey,
  onPanelClose,
  filterEventType,
  onFilterChange,
  widthStorage,
  panelWidth,
  onPanelWidthChange,
}: PanelLayoutProps) {
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accessoryPanelRef = useRef<ImperativePanelHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevPanelKey = useRef<PanelSelectionOptions | null>(panelKey)

  // Always open panel at DEFAULT_PANEL_PX, capped at MAX_PANEL_PERCENT
  useLayoutEffect(() => {
    const isOpening = prevPanelKey.current === null && panelKey !== null

    if (isOpening) {
      const container = containerRef.current
      if (container) {
        const containerWidth = container.getBoundingClientRect().width
        if (containerWidth) {
          const targetPercent = Math.min(
            MAX_OPEN_PERCENT,
            Math.max(
              MIN_PANEL_PERCENT,
              (DEFAULT_PANEL_PX / containerWidth) * 100,
            ),
          )
          accessoryPanelRef.current?.resize(targetPercent)
          onPanelWidthChange?.(targetPercent)
        }
      }
    }

    prevPanelKey.current = panelKey
  }, [panelKey, onPanelWidthChange])

  const title = getPanelTitle(panelKey)

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
          <div className="h-full rounded-lg">{children}</div>
        </Panel>

        {panelKey !== null && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel
              id="accessory"
              ref={accessoryPanelRef}
              maxSize={MAX_PANEL_PERCENT}
              minSize={MIN_PANEL_PERCENT}
              defaultSize={panelWidth || MIN_PANEL_PERCENT}
              onResize={onPanelWidthChange}
              className="border-l"
            >
              <div className="h-full rounded-lg">
                <div
                  className={cn(
                    'dark:bg-background flex h-full flex-col bg-white',
                  )}
                >
                  <div className="border-border border-b px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Text weight="semibold" size="lg" className="flex-1">
                        {title}
                      </Text>
                      <Button size="icon" onClick={onPanelClose}>
                        <X className="size-4" />
                      </Button>
                    </div>
                    {panelKey === 'activity' && onFilterChange && (
                      <FeedFilters
                        filterEventType={filterEventType}
                        onFilterChange={onFilterChange}
                      />
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden pt-4">
                    {panelContent}
                  </div>
                </div>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  )
}
