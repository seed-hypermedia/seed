import {AlertCircle} from '@shm/ui/icons'
import {NavigationButtons, NavMenuButton} from './titlebar-common'
import {WindowsLinuxTitleBar} from './windows-linux-titlebar'

export default function ErrorBarWindowsLinux() {
  return (
    <WindowsLinuxTitleBar
      left={
        <div className="flex gap-2 px-0 py-2">
          <NavMenuButton />
          <NavigationButtons />
        </div>
      }
      title={
        <div className="flex flex-1 items-center justify-center">
          <AlertCircle size={16} className="size-4 text-red-500" />
        </div>
      }
    />
  )
}
