import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button, buttonVariants} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Library, Search} from 'lucide-react'
import {usePublishSite} from './publish-site'
import {SearchInput} from './search-input'
import {Title} from './titlebar-title'

export function TitlebarTitleSearch() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const popoverState = usePopoverState()
  const publishSite = usePublishSite()
  useListenAppEvent('open_launcher', () => {
    popoverState.onOpenChange(true)
  })
  return (
    <Popover {...popoverState}>
      <div className="border-border relative flex w-full items-center gap-2">
        <PopoverTrigger
          className={cn(
            'no-window-drag p-1`',
            buttonVariants({variant: 'ghost', size: 'icon'}),
            // prevents focus ring that looks bad because of the overflow hidden in the parent
            'focus-visible:ring-none focus-visible:border-0 focus-visible:ring-0',
          )}
        >
          <Search className="size-4" />
        </PopoverTrigger>
        <Tooltip content="Open Library">
          <Button
            className="no-window-drag"
            variant={route.key == 'library' ? 'default' : 'ghost'}
            size="xs"
            onClick={() => {
              navigate({
                key: 'library',
              })
            }}
          >
            <Library className="size-3" />
          </Button>
        </Tooltip>
        <Title onPublishSite={publishSite.open} />
        {publishSite.content}
        <PopoverContent
          side="bottom"
          align="start"
          className="no-window-drag w-full max-w-screen border-0 bg-transparent px-4 py-0 pb-4 shadow-none"
        >
          <div className="dark:bg-background border-border h-[260px] min-h-8/10 max-w-2xl overflow-hidden rounded-md border bg-white p-2 shadow-2xl">
            <SearchInput
              onClose={() => popoverState.onOpenChange(false)}
              onSelect={({id, route}) => {
                if (route) {
                  navigate(route)
                } else if (id) {
                  toast.error('Failed to open selected item: ' + id)
                }
              }}
            />
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}
