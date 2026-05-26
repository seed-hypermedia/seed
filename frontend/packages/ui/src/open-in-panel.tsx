import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {DocumentPanelRoute} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {SquareChevronRight} from 'lucide-react'
import {Button} from './button'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function OpenInPanelButton({
  id,
  panelRoute,
  nested = false,
  accent = false,
}: {
  id: UnpackedHypermediaId
  panelRoute: DocumentPanelRoute
  /** When true, button is rendered inside an active tab pill — drop own bg, inherit text color, square the left edge. */
  nested?: boolean
  /** When true (and not nested), render as a full accent pill so the standalone button reads as the active tab. */
  accent?: boolean
}) {
  const replace = useNavigate('replace')

  return (
    <Tooltip content="Open in right panel">
      <Button
        variant={nested ? 'ghost' : accent ? 'accent' : 'ghost'}
        className={cn(
          nested ? 'h-9 rounded-l-none rounded-r-full px-3 hover:bg-black/5 dark:hover:bg-white/10' : 'rounded-full',
        )}
        onClick={() => {
          replace({
            key: 'document',
            id,
            panel: panelRoute,
          })
        }}
      >
        <SquareChevronRight className="size-4" />
      </Button>
    </Tooltip>
  )
}
