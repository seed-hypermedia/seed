import {
  CloseButton,
  WindowsLinuxWindowControls,
} from '@/components/window-controls'
import {TitleText, TitlebarWrapper, XStack, YStack} from '@shm/ui'
import {TitleBarProps} from './titlebar'
import {
  NavMenuButton,
  NavigationButtons,
  PageActionButtons,
} from './titlebar-common'
import {TitlebarSearch} from './titlebar-search'
import './titlebar-windows-linux.css'
import {SystemMenu} from './windows-linux-titlebar'

export default function TitleBarWindows(props: TitleBarProps) {
  if (props.clean) {
    return (
      <TitlebarWrapper>
        <XStack paddingHorizontal="$2">
          <XStack ai="center" flex={1} justifyContent="center">
            <TitleText marginHorizontal="$4" fontWeight="bold">
              {props.cleanTitle}
            </TitleText>
          </XStack>
          <XStack className="no-window-drag">
            <CloseButton />
          </XStack>
        </XStack>
      </TitlebarWrapper>
    )
  }

  return (
    <WindowsLinuxTitleBar
      right={<PageActionButtons />}
      left={
        <XStack
          flex={1}
          paddingHorizontal={0}
          alignItems="flex-start"
          className="window-drag"
          alignSelf="stretch"
          gap="$2"
        >
          <NavMenuButton />
          <NavigationButtons />
        </XStack>
      }
      title={<TitlebarSearch />}
    />
  )
}

export function WindowsLinuxTitleBar({
  left,
  title,
  right,
  platform,
}: {
  title: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
  platform?: string
}) {
  return (
    <YStack>
      <XStack height={24} ai="center">
        <SystemMenu />
        <XStack flex={1} className="window-drag" />
        <WindowsLinuxWindowControls />
      </XStack>

      <TitlebarWrapper platform={platform}>
        <XStack
          paddingRight="$2"
          justifyContent="space-between"
          className="window-drag"
        >
          <XStack
            minWidth={'min-content'}
            flexBasis={0}
            alignItems="center"
            className="window-drag"
          >
            {left}
          </XStack>
          <XStack flex={1} alignItems="center" paddingHorizontal="$2">
            {/* <Title /> */}
            {title}
          </XStack>
          <XStack
            className="window-drag"
            justifyContent="flex-end"
            minWidth={'min-content'}
            flexBasis={0}
            alignItems="center"
            paddingRight="$2"
          >
            {right}
          </XStack>
        </XStack>
      </TitlebarWrapper>
    </YStack>
  )
}
