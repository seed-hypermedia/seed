import {UpdateStatus} from '@/types/updater-types'
import {Button} from '@shm/ui/button'
import {Progress} from '@shm/ui/components/progress'
import {SizableText} from '@shm/ui/text'
import {useState} from 'react'

import {useEffect} from 'react'

// Add type declaration for window.autoUpdate
declare global {
  interface Window {
    autoUpdate?: {
      checkForUpdates: () => void
      onUpdateStatus: (handler: (status: UpdateStatus) => void) => void
      setUpdateStatus: (status: UpdateStatus) => void
      downloadAndInstall: () => void
      releaseNotes: () => void
    }
  }
}

export function AutoUpdater() {
  const updateStatus = useUpdateStatus()

  const handleDownloadAndInstall = () => {
    window.autoUpdate?.downloadAndInstall()
  }

  function handleLater() {
    window.autoUpdate?.setUpdateStatus({type: 'idle'})
  }

  return (
    <div
      className="absolute right-5 bottom-5 z-40 flex min-h-[100px] min-w-[360px] flex-col gap-4 rounded bg-white p-4 shadow-md dark:bg-black"
      style={{
        transform:
          updateStatus?.type == 'update-available' ||
          updateStatus?.type == 'downloading' ||
          updateStatus?.type == 'restarting'
            ? 'translateX(0)'
            : 'translateX(500px)',
        transition: 'transform 0.5s ease-in-out, opacity 0.5s ease-in-out',
        opacity:
          updateStatus?.type == 'update-available' ||
          updateStatus?.type == 'downloading' ||
          updateStatus?.type == 'restarting'
            ? 1
            : 0,
      }}
    >
      <SizableText>{getUpdateStatusLabel(updateStatus)}</SizableText>
      {updateStatus?.type == 'update-available' && updateStatus.updateInfo ? (
        <div className="flex gap-2">
          <Button variant="default" onClick={handleDownloadAndInstall}>
            Download and Install
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => handleLater()}
          >
            Later
          </Button>
          {updateStatus?.type == 'update-available' &&
            updateStatus.updateInfo.release_notes && (
              <Button
                variant="outline"
                onClick={() => window.autoUpdate?.releaseNotes()}
              >
                Release Notes
              </Button>
            )}
        </div>
      ) : updateStatus?.type == 'downloading' ? (
        <div className="flex flex-col gap-2">
          <Progress key="download-progress" value={updateStatus.progress} />
        </div>
      ) : null}
    </div>
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
