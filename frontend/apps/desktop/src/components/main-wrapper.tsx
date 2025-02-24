import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {useStream} from '@shm/ui/use-stream'
import {ScrollView, View, XStack, YStackProps} from 'tamagui'
import {SidebarWidth, useSidebarContext} from '../sidebar-context'

export function SidebarSpacer() {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const sidebarSpacing = isLocked ? SidebarWidth : 0
  return <View style={{maxWidth: sidebarSpacing, width: '100%'}} />
}

export function MainWrapper({children, ...props}: YStackProps & {}) {
  return (
    <XStack flex={1} {...props}>
      <SidebarSpacer />
      {/* TODO: we cannot remove this ID here because the SlashMenu is referencing
      this! */}
      <ScrollView
        id="scroll-page-wrapper"
        scrollEventThrottle={1000}
        onScroll={() => {
          dispatchScroll('scroll')
        }}
      >
        {children}
      </ScrollView>
    </XStack>
  )
}

export function MainWrapperStandalone({children, ...props}: YStackProps & {}) {
  return (
    <XStack flex={1} {...props}>
      {/* TODO: we cannot remove this ID here because the SlashMenu is referencing
      this! */}
      <ScrollView
        id="scroll-page-wrapper"
        scrollEventThrottle={1000}
        onScroll={() => {
          dispatchScroll('scroll')
        }}
      >
        {children}
      </ScrollView>
    </XStack>
  )
}

export function MainWrapperNoScroll({children, ...props}: YStackProps & {}) {
  return (
    <XStack flex={1} {...props}>
      <SidebarSpacer />
      {children}
    </XStack>
  )
}
