import {useSidebarWidth} from '@/sidebar-context'
import {TitleText, TitlebarWrapper} from '@shm/ui/titlebar'
import {View, XStack} from 'tamagui'
import {TitleBarProps} from './titlebar'
import {
  NavMenuButton,
  NavigationButtons,
  PageActionButtons,
} from './titlebar-common'
import {TitlebarTitleSearch} from './titlebar-search'

export default function TitleBarMacos(props: TitleBarProps) {
  const {clean, cleanTitle, ...restProps} = props
  const sidebarWidth = useSidebarWidth()
  if (clean) {
    return (
      <TitlebarWrapper {...restProps}>
        <XStack className="window-drag" ai="center" jc="center" w="100%">
          <TitleText
            marginHorizontal="$4"
            fontWeight="bold"
            f={1}
            textAlign="center"
          >
            {cleanTitle}
          </TitleText>
        </XStack>
      </TitlebarWrapper>
    )
  }

  return (
    <TitlebarWrapper {...restProps}>
      <XStack
        paddingRight="$2"
        justifyContent="space-between"
        className="window-drag"
        height="100%"
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
            minWidth={sidebarWidth}
          >
            <NavMenuButton
              left={
                <View
                  width={72} // this width to stay away from the macOS window traffic lights
                />
              }
            />
            <NavigationButtons />
          </XStack>
        </XStack>
        <XStack flex={1} alignItems="center" paddingHorizontal="$2">
          <TitlebarTitleSearch />
        </XStack>
        <XStack
          className="window-drag"
          justifyContent="flex-end"
          minWidth={'min-content'}
          flexBasis={0}
          alignItems="center"
        >
          <PageActionButtons {...restProps} />
        </XStack>
      </XStack>
    </TitlebarWrapper>
  )
}
