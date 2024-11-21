import {useListenAppEvent} from '@/utils/window-events'
import {Button, Search, View, XStack, YStack} from '@shm/ui'
import {useState} from 'react'
import {SearchInput} from './search-input'
import {Title} from './titlebar-title'

export function TitlebarSearch() {
  const [showLauncher, setShowLauncher] = useState(false)
  useListenAppEvent('openLauncher', () => {
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
        // hoverStyle={{
        //   cursor: 'text !important',
        // }}
        onPress={() => {
          setShowLauncher((v) => !v)
        }}
      />
      <Title />
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
        zIndex="$zIndex.8"
      />
      <YStack
        elevation="$4"
        className="no-window-drag"
        minHeight="80%"
        position="absolute"
        top={0}
        left={0}
        zi="$zIndex.8"
        width="100%"
        maxWidth={800}
        bg="$backgroundStrong"
        backgroundColor="$backgroundStrong"
        borderColor="$color7"
        borderWidth={1}
        borderRadius={6}
      >
        <SearchInput onClose={onClose} />
      </YStack>
    </>
  )
}
