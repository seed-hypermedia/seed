import {useLocalKeyPair} from '@/auth'
import {isPendingSpaceUid} from '@shm/shared/utils/pending-space'
import {DropdownMenuItem} from '@shm/ui/components/dropdown-menu'
import {PanelsTopLeft} from 'lucide-react'

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
    <button className="hover:bg-accent flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left" onClick={onSelect}>
      <PanelsTopLeft className="size-4" />
      <span className="text-sm">Space settings</span>
    </button>
  ) : (
    <DropdownMenuItem onSelect={onSelect}>
      <PanelsTopLeft className="size-4" />
      Space settings
    </DropdownMenuItem>
  )
}
