import {
  CloseButton,
  WindowsLinuxWindowControls,
} from '@/components/window-controls'
import {
  TitleText,
  TitlebarRow,
  TitlebarSection,
  TitlebarWrapper,
  XStack,
  YStack,
} from '@shm/ui'
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
        <XStack>
          <TitleText marginHorizontal="$4" fontWeight="bold">
            {props.cleanTitle}
          </TitleText>
          <XStack className="no-window-drag">
            <CloseButton />
          </XStack>
        </XStack>
      </TitlebarWrapper>
    )
  }

  return (
    <WindowsLinuxTitleBar
      right={<PageActionButtons {...props} />}
      left={
        <XStack paddingHorizontal={0} paddingVertical="$2" space="$2">
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
}: {
  title: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <YStack>
      <XStack bg="red" height={24} ai="center">
        <SystemMenu />
      </XStack>

      <TitlebarWrapper>
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
            <XStack
              flex={1}
              paddingHorizontal={0}
              alignItems="flex-start"
              className="window-drag"
              gap="$2"
            >
              <NavMenuButton />
              <NavigationButtons />
            </XStack>
          </XStack>
          <XStack flex={1} alignItems="center" paddingHorizontal="$2">
            {/* <Title /> */}
            <TitlebarSearch />
          </XStack>
          <XStack
            className="window-drag"
            justifyContent="flex-end"
            minWidth={'min-content'}
            flexBasis={0}
            alignItems="center"
          >
            <PageActionButtons />
          </XStack>
        </XStack>
      </TitlebarWrapper>
    </YStack>
  )

  return (
    <TitlebarWrapper className="window-drag" style={{flex: 'none'}}>
      <TitlebarRow minHeight={28} backgroundColor="$color3">
        <TitlebarSection>
          <SystemMenu />
        </TitlebarSection>
        <XStack flex={1} />
        <TitlebarSection space>
          <WindowsLinuxWindowControls />
        </TitlebarSection>
      </TitlebarRow>
      <TitlebarRow>
        <XStack
          flex={1}
          minWidth={'min-content'}
          flexBasis={0}
          alignItems="center"
          className="window-drag"
        >
          {left}
        </XStack>
        <XStack
          f={1}
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
          height="100%"
          ai="center"
          jc="center"
        >
          {title}
        </XStack>
        <XStack
          flex={1}
          justifyContent="flex-end"
          minWidth={'min-content'}
          flexBasis={0}
          className="window-drag"
          alignItems="center"
        >
          {right}
        </XStack>
      </TitlebarRow>
    </TitlebarWrapper>
  )
}
