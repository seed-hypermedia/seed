import {TitleText, TitlebarWrapper, View, XStack} from '@shm/ui'
import {TitleBarProps} from './titlebar'
import {
  NavMenuButton,
  NavigationButtons,
  PageActionButtons,
} from './titlebar-common'
import {TitlebarTitleSearch} from './titlebar-search'

export default function TitleBarMacos(props: TitleBarProps) {
  if (props.clean) {
    return (
      <TitlebarWrapper {...props}>
        <XStack>
          <View
            width={72} // this width to stay away from the macOS window traffic lights
          />
          <TitleText marginHorizontal="$4" fontWeight="bold">
            {props.cleanTitle}
          </TitleText>
        </XStack>
      </TitlebarWrapper>
    )
  }

  return (
    <TitlebarWrapper {...props}>
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
          <PageActionButtons {...props} />
        </XStack>
      </XStack>
    </TitlebarWrapper>
  )
}
