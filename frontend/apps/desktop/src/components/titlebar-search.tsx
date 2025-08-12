import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {Search} from 'lucide-react'
import {useState} from 'react'
import {usePublishSite} from './publish-site'
import {SearchInput} from './search-input'
import {Title} from './titlebar-title'

export function TitlebarTitleSearch() {
  const [showLauncher, setShowLauncher] = useState(false)
  const publishSite = usePublishSite()
  useListenAppEvent('open_launcher', () => {
    setShowLauncher(true)
  })
  return (
    <div className="border-border relative flex w-full items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="no-window-drag"
        onClick={() => {
          setShowLauncher((v) => !v)
        }}
      >
        <Search className="size-4" />
      </Button>
      <Title onPublishSite={publishSite.open} />
      {publishSite.content}
      {showLauncher ? (
        <LauncherContent
          onClose={() => {
            console.log('closing launcher')
            setShowLauncher(false)
          }}
        />
      ) : null}
    </div>
  )
}

function LauncherContent({onClose}: {onClose: () => void}) {
  const navigate = useNavigate()
  return (
    <>
      <div
        className="fixed top-0 right-0 bottom-0 left-0 z-50"
        onClick={onClose}
      />
      <div className="no-window-drag dark:bg-background border-border absolute top-0 left-0 z-50 mt-6 h-[260px] min-h-8/10 w-full max-w-2xl overflow-hidden rounded-md border bg-white p-2 shadow-xl">
        <SearchInput
          onClose={onClose}
          onSelect={({id, route}) => {
            if (route) {
              navigate(route)
            } else if (id) {
              toast.error('Failed to open selected item: ' + id)
            }
          }}
        />
      </div>
    </>
  )
}
