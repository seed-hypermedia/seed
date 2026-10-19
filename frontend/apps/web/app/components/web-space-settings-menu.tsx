import {useLocalKeyPair} from '@/auth'
import {isPendingSpaceUid} from '@shm/shared/utils/pending-space'
import {DropdownMenuItem} from '@shm/ui/components/dropdown-menu'
import {Settings} from 'lucide-react'

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
    <button className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onSelect}>
      <Settings className="size-5" />
      <span className="text-sm">Space Settings</span>
    </button>
  ) : (
    <DropdownMenuItem onSelect={onSelect}>
      <Settings className="size-4" />
      Space Settings
    </DropdownMenuItem>
  )
}
