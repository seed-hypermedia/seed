import {useSidebarContext, useSidebarWidth} from '@/sidebar-context'
import {useStream} from '@shm/shared/use-stream'
import {TitleText, TitlebarWrapper} from '@shm/ui/titlebar'
import {TitleBarProps} from './titlebar'
import {NavMenuButton, NavigationButtons, Omnibar, PageActionButtons} from './titlebar-common'
import {TitlebarMainRow} from './titlebar-layout'

export default function TitleBarMacos(props: TitleBarProps) {
  const {clean, cleanTitle, ...restProps} = props
  const sidebarWidth = useSidebarWidth()
  const sidebarContext = useSidebarContext()
  const isSidebarLocked = !!useStream(sidebarContext.isLocked)
  if (clean) {
    return (
      <TitlebarWrapper className="min-h-0" {...restProps}>
        <div className="window-drag flex w-full items-center justify-center">
          <TitleText className="text-center font-bold">{cleanTitle}</TitleText>
        </div>
      </TitlebarWrapper>
    )
  }

  return (
    <TitlebarWrapper {...restProps}>
      <TitlebarMainRow
        sidebarLocked={isSidebarLocked}
        sidebarWidth={sidebarWidth}
        sidebarControl={
          <NavMenuButton
            left={
              isSidebarLocked ? undefined : (
                <div
                  className="w-[72px]" // this width to stay away from the macOS window traffic lights
                />
              )
            }
          />
        }
        navigation={<NavigationButtons />}
        omnibar={<Omnibar />}
        actions={<PageActionButtons {...restProps} />}
      />
    </TitlebarWrapper>
  )
}
