import {TitlebarWrapper} from '@shm/ui/titlebar'
import {AlertCircle} from '@tamagui/lucide-icons'
import {XStack} from 'tamagui'
import {useSidebarWidth} from '../sidebar-context'
import {NavMenuButton, NavigationButtons} from './titlebar-common'
export default function ErrorBar() {
  const sidebarWidth = useSidebarWidth()

  return (
    <TitlebarWrapper>
      <XStack jc="space-between">
        <XStack gap="$2" alignItems="center" minWidth={sidebarWidth}>
          <NavMenuButton />
          <NavigationButtons />
        </XStack>
        <XStack f={1} jc="center" alignItems="center">
          <AlertCircle size="$1" color="$red10" />
        </XStack>
      </XStack>
    </TitlebarWrapper>
  )
}
