import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {toast} from '@shm/ui/toast'
import {Search} from '@tamagui/lucide-icons'
import {useState} from 'react'
import {Button, XStack} from 'tamagui'
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
    <XStack
      ai="center"
      position="relative"
      gap="$2"
      w="100%"
      borderColor="$color7"
    >
      <Button
        chromeless
        size="$2"
        className="no-window-drag"
        icon={Search}
        hoverStyle={{
          bg: '$color6',
        }}
        // hoverStyle={{
        //   cursor: 'text !important',
        // }}
        onPress={() => {
          setShowLauncher((v) => !v)
        }}
      />
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
    </XStack>
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
      <div className="no-window-drag dark:bg-background border-border absolute top-0 left-0 z-[999] mt-6 h-[260px] min-h-8/10 w-full max-w-2xl overflow-hidden rounded-md border bg-white p-2">
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
