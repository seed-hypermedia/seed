import {UpdateStatus} from '@/types/updater-types'
import {useState} from 'react'
import {Button, Progress, SizableText, XStack, YStack} from 'tamagui'

import {useEffect} from 'react'

// Add type declaration for window.autoUpdate
declare global {
  interface Window {
    autoUpdate?: {
      onUpdateStatus: (handler: (status: UpdateStatus) => void) => void
      setUpdateStatus: (status: UpdateStatus) => void
      downloadAndInstall: () => void
      releaseNotes: () => void
    }
  }
}

export function AutoUpdater() {
  const updateStatus = useUpdateStatus()

  console.log(`== ~ AutoUpdater ~ updateStatus:`, updateStatus)

  const handleDownloadAndInstall = () => {
    window.autoUpdate?.downloadAndInstall()
  }

  function handleLater() {
    window.autoUpdate?.setUpdateStatus({type: 'idle'})
  }

  return (
    <YStack
      position="absolute"
      gap="$4"
      right={20}
      bottom={20}
      minWidth={360}
      minHeight={100}
      borderRadius="$2"
      zIndex={10000}
      elevation="$4"
      bg="$backgroundStrong"
      padding="$4"
      x={updateStatus == null || updateStatus?.type == 'idle' ? 500 : 0}
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
      <SizableText size="$2">{getUpdateStatusLabel(updateStatus)}</SizableText>
      {updateStatus?.type == 'update-available' && updateStatus.updateInfo ? (
        <XStack gap="$2">
          <Button
            size="$2"
            onPress={handleDownloadAndInstall}
            bg="$brand5"
            color="white"
            borderColor="$colorTransparent"
            hoverStyle={{bg: '$brand4', borderColor: '$colorTransparent'}}
            focusStyle={{bg: '$brand4', borderColor: '$colorTransparent'}}
          >
            Download and Update
          </Button>
          <Button
            size="$2"
            onPress={() => handleLater()}
            hoverStyle={{
              bg: '$backgroundStrong',
              borderColor: '$colorTransparent',
            }}
            focusStyle={{
              bg: '$backgroundStrong',
              borderColor: '$colorTransparent',
            }}
          >
            Later
          </Button>
          {updateStatus?.type == 'update-available' &&
            updateStatus.updateInfo.release_notes && (
              <Button
                size="$2"
                hoverStyle={{
                  bg: '$backgroundStrong',
                  borderColor: '$colorTransparent',
                }}
                focusStyle={{
                  bg: '$backgroundStrong',
                  borderColor: '$colorTransparent',
                }}
                onPress={() => window.autoUpdate?.releaseNotes()}
              >
                Release Notes
              </Button>
            )}
        </XStack>
      ) : updateStatus?.type == 'downloading' ? (
        <YStack gap="$2">
          <Progress
            key="download-progress"
            size="$1"
            value={updateStatus.progress}
          >
            <Progress.Indicator animation="medium" bg="$brand5" />
          </Progress>
          {/* <Button size="$2" onPress={handleLater}>
            Cancel
          </Button> */}
        </YStack>
      ) : null}
    </YStack>
  )
}

export function useUpdateStatus() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    window.autoUpdate?.onUpdateStatus((status) => {
      //   console.log('== UPDATE ON UPDATE AVAILABLE', updateInfo)
      setUpdateStatus(status)
    })
  }, [])

  return updateStatus
}

export function getUpdateStatusLabel(updateStatus: UpdateStatus | null) {
  if (updateStatus == null) return updateStatus
  switch (updateStatus.type) {
    case 'update-available':
      return `Update available (${updateStatus.updateInfo.name})`
    case 'checking':
      return 'Checking for updates...'
    case 'downloading':
      return `Downloading update... (${updateStatus.progress}%)`
    case 'restarting':
      return 'Restarting...'
    case 'error':
      return `Update error: ${updateStatus.error}`
    default: // idle
      return null
  }
}
