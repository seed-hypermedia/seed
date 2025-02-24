import {UpdateInfo} from '@/types/updater-types'
import {Button, SizableText, XStack, YStack} from '@shm/ui'
import {useState} from 'react'

import {useEffect} from 'react'

export function AutoUpdaterInfo() {
  const updateStatus = useUpdateStatus()
  //   const updateStatus = true

  const handleDownloadAndInstall = () => {
    window.autoUpdate?.downloadAndInstall()
  }

  return (
    <YStack
      position="absolute"
      gap="$4"
      right={20}
      bottom={20}
      borderRadius="$2"
      zIndex={10000}
      elevation="$4"
      bg="$backgroundStrong"
      padding="$4"
      x={updateStatus ? 0 : 500}
      animation={[
        'slow',
        {
          opacity: {
            overshootClamping: true,
          },
        },
      ]}
      enterStyle={{x: 500, opacity: 0}}
      exitStyle={{y: 500, opacity: 0}}
    >
      <SizableText>There is an Update available.</SizableText>
      <XStack gap="$2">
        <Button
          size="$2"
          onPress={handleDownloadAndInstall}
          theme="brand"
          color="white"
        >
          Download and Update
        </Button>
        <Button size="$2">Later</Button>
        <Button size="$2">Release Notes</Button>
      </XStack>
    </YStack>
  )
}

export function useUpdateStatus() {
  const [updateStatus, setUpdateStatus] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    window.autoUpdate?.onUpdateAvailable((updateInfo) => {
      console.log('== UPDATE ON UPDATE AVAILABLE', updateInfo)
      setUpdateStatus(updateInfo)
    })
  }, [])

  return updateStatus
}

export function useCheckForUpdates() {
  const [checkForUpdates, setCheckForUpdates] = useState(false)
  useEffect(() => {
    window.autoUpdate?.onCheckForUpdates((checkingForUpdates) => {
      console.log('== UPDATE CHECKING FOR UPDATES', checkingForUpdates)
      setCheckForUpdates(checkingForUpdates)
    })
  }, [])

  return checkForUpdates
}

// Add type declaration for window.autoUpdate
declare global {
  interface Window {
    autoUpdate?: {
      onCheckForUpdates: (handler: (event: any) => void) => void
      onUpdateAvailable: (handler: (updateInfo: any) => void) => void
      downloadAndInstall: () => void
    }
  }
}

/**
 * states
 * - idle
 * - checking for updates
 * - update available
 * - downloading update
 * - download complete
 * - installing update (final)
 * - update failed
 *
 * context
 * -
 */
