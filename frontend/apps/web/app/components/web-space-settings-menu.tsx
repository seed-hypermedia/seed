import {useLocalKeyPair} from '@/auth'
import {isPendingSpaceUid} from '@shm/shared/utils/pending-space'
import {DialogTitle} from '@shm/ui/components/dialog'
import {DropdownMenuItem} from '@shm/ui/components/dropdown-menu'
import {Spinner} from '@shm/ui/spinner'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Settings} from 'lucide-react'
import {lazy, Suspense} from 'react'

const LazySettings = lazy(() =>
  import('./web-space-settings').then((module) => ({default: module.WebSpaceSettingsDialog})),
)

function SettingsDialog(props: {input: {siteUid: string}; onClose: () => void}) {
  return (
    <Suspense
      fallback={
        <>
          <DialogTitle>Space Settings</DialogTitle>
          <Spinner />
        </>
      }
    >
      <LazySettings {...props} />
    </Suspense>
  )
}

/** Load settings only when an owner opens them, keeping hosting code out of the header bundle. */
export function useWebSpaceSettingsDialog() {
  return useAppDialog(SettingsDialog, {
    className: 'max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl',
    contentClassName: 'overflow-y-auto',
  })
}

/** Both account menus offer settings only for the space owned by the active delegated identity. */
export function WebSpaceSettingsMenuItem({
  siteUid,
  mobile,
  onSelect,
}: {
  siteUid: string
  mobile?: boolean
  onSelect: () => void
}) {
  const identity = useLocalKeyPair()
  if (!identity?.delegatedAccountUid || identity.delegatedAccountUid !== siteUid || isPendingSpaceUid(siteUid))
    return null
  return mobile ? (
    <button
      className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
      aria-haspopup="dialog"
      onClick={onSelect}
    >
      <Settings className="size-5" />
      <span className="text-sm">Space Settings</span>
    </button>
  ) : (
    <DropdownMenuItem aria-haspopup="dialog" onSelect={onSelect}>
      <Settings className="size-4" />
      Space Settings
    </DropdownMenuItem>
  )
}
