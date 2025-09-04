import {
  CloseButton,
  WindowsLinuxWindowControls,
} from '@/components/window-controls'
import {useSidebarWidth} from '@/sidebar-context'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {TitleBarProps} from './titlebar'
import {
  NavigationButtons,
  NavMenuButton,
  PageActionButtons,
} from './titlebar-common'
import {TitlebarTitleSearch} from './titlebar-search'
import './titlebar-windows-linux.css'
import {SystemMenu} from './windows-linux-titlebar'

export default function TitleBarWindows(props: TitleBarProps) {
  const sidebarWidth = useSidebarWidth()

  if (props.clean) {
    return (
      <TitlebarWrapper className="min-h-0">
        <div className="window-drag flex px-2">
          <div className="window-drag flex flex-1 items-center justify-center">
            <TitleText marginHorizontal="$4" fontWeight="bold">
              {props.cleanTitle}
            </TitleText>
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
      right={<PageActionButtons />}
      left={
        <div
          className="window-drag flex flex-1 items-start gap-2 px-0"
          style={{minWidth: sidebarWidth}}
        >
          <NavMenuButton />
          <NavigationButtons />
        </div>
      }
      title={<TitlebarTitleSearch />}
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
      <TitlebarWrapper platform={platform}>
        <div className="window-drag flex justify-between pr-2">
          <div className="window-drag flex min-w-min basis-0 items-center">
            {left}
          </div>
          <div className="flex flex-1 items-center overflow-x-hidden px-2">
            {/* <Title /> */}
            {title}
          </div>
          <div className="window-drag flex min-w-min basis-0 items-center justify-end pr-2">
            {right}
          </div>
        </div>
      </TitlebarWrapper>
    </div>
  )
}
