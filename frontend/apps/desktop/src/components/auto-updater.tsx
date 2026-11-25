import {UpdateStatus} from '@/types/updater-types'
import {Button} from '@shm/ui/button'
import {Progress} from '@shm/ui/components/progress'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useEffect, useState} from 'react'

// Add type declaration for window.autoUpdate
declare global {
  interface Window {
    autoUpdate?: {
      checkForUpdates: () => void
      onUpdateStatus: (handler: (status: UpdateStatus) => void) => () => void
      dismiss: () => void
      download: () => void
      restart: () => void
      releaseNotes: () => void
    }
  }
}

/** Displays update progress and requires explicit consent before restarting. */
export function AutoUpdater() {
  const updateStatus = useUpdateStatus()

  useEffect(() => {
    if (updateStatus?.type === 'up-to-date') {
      toast.success("You're up to date")
    }
  }, [updateStatus])

  if (
    !updateStatus ||
    updateStatus.type === 'idle' ||
    updateStatus.type === 'up-to-date' ||
    updateStatus.type === 'checking' ||
    updateStatus.type === 'flatpak-info' ||
    updateStatus.type === 'appimage-info' ||
    (updateStatus.type === 'ready-to-restart' && updateStatus.deferred)
  )
    return null

  return (
    <div
      className="absolute right-5 bottom-5 z-40 flex min-h-[100px] min-w-[360px] flex-col gap-4 rounded bg-white p-4 shadow-md dark:bg-black"
      role="status"
    >
      <SizableText>{getUpdateStatusLabel(updateStatus)}</SizableText>
      {updateStatus.type === 'update-available' ? (
        <div className="flex gap-2">
          <Button variant="default" onClick={() => window.autoUpdate?.download()}>
            Download Update
          </Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={() => window.autoUpdate?.dismiss()}>
            Later
          </Button>
          {updateStatus.updateInfo.release_notes && (
            <Button variant="outline" onClick={() => window.autoUpdate?.releaseNotes()}>
              Release Notes
            </Button>
          )}
        </div>
      ) : updateStatus.type === 'ready-to-restart' ? (
        <>
          <SizableText size="sm">Keep working and restart when you’re ready.</SizableText>
          <div className="flex gap-2">
            <Button variant="default" onClick={() => window.autoUpdate?.restart()}>
              Restart
            </Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={() => window.autoUpdate?.dismiss()}>
              Later
            </Button>
          </div>
        </>
      ) : updateStatus.type === 'error' ? (
        <div className="flex gap-2">
          <Button variant="default" onClick={() => window.autoUpdate?.checkForUpdates()}>
            Check Again
          </Button>
          <Button variant="ghost" onClick={() => window.autoUpdate?.dismiss()}>
            Later
          </Button>
        </div>
      ) : updateStatus.type === 'downloading' ? (
        <div className="flex flex-col gap-2">
          <Progress key="download-progress" value={updateStatus.progress} />
        </div>
      ) : null}
    </div>
  )
}

/** Subscribes to the main-process actor, including its current state on mount. */
export function useUpdateStatus() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    return window.autoUpdate?.onUpdateStatus(setUpdateStatus)
  }, [])

  return updateStatus
}

/** Formats the shared updater panel and footer status. */
export function getUpdateStatusLabel(updateStatus: UpdateStatus | null) {
  if (updateStatus == null) return updateStatus
  switch (updateStatus.type) {
    case 'update-available':
      return `Update available (${updateStatus.updateInfo.name})`
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading update... (${updateStatus.progress}%)`
    case 'verifying':
      return 'Verifying update…'
    case 'ready-to-restart':
      return `Update ready (${updateStatus.updateInfo.name})`
    case 'restarting':
      return 'Installing update and restarting…'
    case 'error':
      return `Update error: ${updateStatus.error}`
    default: // idle
      return null
  }
}
