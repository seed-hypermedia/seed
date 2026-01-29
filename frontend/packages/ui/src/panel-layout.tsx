import {PanelSelectionOptions} from '@shm/shared'
import {useLayoutEffect, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Button} from './button'
import {panelContainerStyles} from './container'
import {FeedFilters} from './feed-filters'
import {Text} from './text'
import {cn} from './utils'
import {X} from 'lucide-react'

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

  // Enforce 480px minimum when opening the accessory panel
  useLayoutEffect(() => {
    const isOpening = prevPanelKey.current === null && panelKey !== null

    if (isOpening) {
      const container = containerRef.current
      if (container) {
        const containerWidth = container.getBoundingClientRect().width
        if (containerWidth) {
          const storedPercent = panelWidth || 20
          const pixelValue = (storedPercent / 100) * containerWidth

          // If the stored percentage would result in less than 480px, adjust it
          if (pixelValue < 480) {
            const newPercent = Math.min(50, (480 / containerWidth) * 100)
            onPanelWidthChange?.(newPercent)
          }
        }
      }
    }

    prevPanelKey.current = panelKey
  }, [panelKey, panelWidth, onPanelWidthChange])

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
        <Panel id="main" minSize={50} className="p-0.5 pr-1">
          <div className="h-full rounded-lg">{children}</div>
        </Panel>

        {panelKey !== null && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel
              id="accessory"
              ref={accessoryPanelRef}
              maxSize={50}
              minSize={20}
              defaultSize={panelWidth || 20}
              onResize={onPanelWidthChange}
              className="p-0.5 pl-1"
            >
              <div className="h-full rounded-lg">
                <div
                  className={cn(
                    panelContainerStyles,
                    'dark:bg-background flex flex-col bg-white',
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
