import {useSidebarWidth} from '@/sidebar-context'
import {TitleText, TitlebarWrapper} from '@shm/ui/titlebar'
import {View} from 'tamagui'
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
        <div className="window-drag flex w-full items-center justify-center">
          <TitleText
            marginHorizontal="$4"
            fontWeight="bold"
            f={1}
            textAlign="center"
          >
            {cleanTitle}
          </TitleText>
        </div>
      </TitlebarWrapper>
    )
  }

  return (
    <TitlebarWrapper {...restProps}>
      <div className="window-drag flex w-full items-center justify-between pr-2">
        <div className="flex-basis-0 window-drag flex min-w-min items-center">
          <div
            className="window-drag flex flex-1 items-center gap-2 px-0"
            style={{
              minWidth: sidebarWidth,
            }}
          >
            <NavMenuButton
              left={
                <View
                  width={72} // this width to stay away from the macOS window traffic lights
                />
              }
            />
            <NavigationButtons />
          </div>
        </div>
        <div className="flex flex-1 items-center gap-2 px-2">
          <TitlebarTitleSearch />
        </div>
        <div className="flex-basis-0 window-drag flex min-w-min items-center justify-end">
          <PageActionButtons {...restProps} />
        </div>
      </div>
    </TitlebarWrapper>
  )
}
