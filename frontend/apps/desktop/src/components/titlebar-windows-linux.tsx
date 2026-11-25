import {CloseButton, WindowsLinuxWindowControls} from '@/components/window-controls'
import {useSidebarContext, useSidebarWidth} from '@/sidebar-context'
import {useStream} from '@shm/shared/use-stream'
import {SiteSidebarToggle} from '@shm/ui/site-sidebar-context'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {TitleBarProps} from './titlebar'
import {NavigationButtons, Omnibar, PageActionButtons} from './titlebar-common'
import {TitlebarMainRow} from './titlebar-layout'
import './titlebar-windows-linux.css'
import {SystemMenu} from './windows-linux-titlebar'

export default function TitleBarWindows(props: TitleBarProps) {
  const sidebarWidth = useSidebarWidth()
  const sidebarContext = useSidebarContext()
  const isSidebarLocked = !!useStream(sidebarContext.isLocked)

  if (props.clean) {
    return (
      <TitlebarWrapper className="min-h-0">
        <div className="window-drag flex px-2">
          <div className="window-drag flex flex-1 items-center justify-center">
            <TitleText className="mx-4 font-bold">{props.cleanTitle}</TitleText>
          </div>
          <div className="no-window-drag flex">
            <CloseButton />
          </div>
        </div>
      </TitlebarWrapper>
    )
  }

  return (
    <WindowsLinuxTitleBar
      content={
        <TitlebarMainRow
          sidebarLocked={isSidebarLocked}
          sidebarWidth={sidebarWidth}
          sidebarControl={<SiteSidebarToggle />}
          navigation={<NavigationButtons />}
          omnibar={<Omnibar />}
          actions={<PageActionButtons />}
        />
      }
    />
  )
}

export function WindowsLinuxTitleBar({content, platform}: {content: React.ReactNode; platform?: string}) {
  return (
    <div className="flex flex-col">
      <div
        className="border-b-border flex h-6 items-center border-b"
        style={{
          backgroundColor: 'var(--background)',
        }}
      >
        <SystemMenu />
        <div className="window-drag flex h-full flex-1" />
        <WindowsLinuxWindowControls />
      </div>

      {/* @ts-expect-error */}
      <TitlebarWrapper platform={platform}>{content}</TitlebarWrapper>
    </div>
  )
}
