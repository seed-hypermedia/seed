import {AlertCircle} from '@tamagui/lucide-icons'
import {XStack} from 'tamagui'
import {NavigationButtons, NavMenuButton} from './titlebar-common'
import {WindowsLinuxTitleBar} from './windows-linux-titlebar'

export default function ErrorBarWindowsLinux() {
  return (
    <WindowsLinuxTitleBar
      left={
        <XStack paddingHorizontal={0} paddingVertical="$2" gap="$2">
          <NavMenuButton />
          <NavigationButtons />
        </XStack>
      }
      title={
        <XStack f={1} jc="center" alignItems="center">
          <AlertCircle size="$1" color="$red10" />
        </XStack>
      }
    />
  )
}
