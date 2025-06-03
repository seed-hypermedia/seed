import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {Search} from '@shm/ui/icons'
import {toast} from '@shm/ui/toast'
import {useState} from 'react'
import {Button, View, XStack, YStack} from 'tamagui'
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
      <View
        onPress={onClose}
        top={0}
        left={0}
        right={0}
        bottom={0}
        // @ts-ignore
        position="fixed"
        zIndex="$zIndex.9"
      />
      <YStack
        elevation="$4"
        className="no-window-drag"
        minHeight="80%"
        position="absolute"
        top={0}
        left={0}
        zi={5000}
        width="100%"
        maxWidth={800}
        bg="$backgroundStrong"
        backgroundColor="$backgroundStrong"
        borderColor="$color7"
        borderWidth={1}
        borderRadius={6}
        h={260}
        padding="$2"
        overflow="hidden"
        marginTop="$3"
      >
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
      </YStack>
    </>
  )
}
