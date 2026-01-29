import {DocumentPanelRoute, UnpackedHypermediaId} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {SquareChevronRight} from 'lucide-react'
import {Button} from './button'
import {Tooltip} from './tooltip'

export function OpenInPanelButton({
  id,
  panelRoute,
}: {
  id: UnpackedHypermediaId
  panelRoute: DocumentPanelRoute
}) {
  const replace = useNavigate('replace')

  return (
    <Tooltip content="Open in right panel">
      <Button
        className="mx-2 shadow-sm"
        onClick={() => {
          replace({
            key: 'document',
            id,
            panel: panelRoute,
          })
        }}
      >
        <SquareChevronRight />
      </Button>
    </Tooltip>
  )
}
