import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {buttonVariants} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {toast} from '@shm/ui/toast'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Search} from 'lucide-react'
import {usePublishSite} from './publish-site'
import {SearchInput} from './search-input'
import {Title} from './titlebar-title'

export function TitlebarTitleSearch() {
  const navigate = useNavigate()
  const popoverState = usePopoverState()
  const publishSite = usePublishSite()
  useListenAppEvent('open_launcher', () => {
    popoverState.onOpenChange(true)
  })
  return (
    <Popover {...popoverState}>
      <div className="border-border no-window-drag relative flex w-full items-center gap-2">
        <PopoverTrigger
          className={cn(
            'no-window-drag`',
            buttonVariants({variant: 'ghost', size: 'icon'}),
          )}
        >
          <Search className="size-4" />
        </PopoverTrigger>
        <Title onPublishSite={publishSite.open} />
        {publishSite.content}
        <PopoverContent
          side="bottom"
          align="start"
          className="no-window-drag w-full max-w-screen border-0 bg-transparent px-4 py-0 shadow-none"
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
