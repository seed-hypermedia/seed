import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {useStream} from '@shm/ui/use-stream'
import {ScrollView, View, XStack, YStack, YStackProps} from 'tamagui'
import {SidebarWidth, useSidebarContext} from '../sidebar-context'

export function SidebarSpacer() {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const sidebarSpacing = isLocked ? SidebarWidth : 0
  return <View style={{maxWidth: sidebarSpacing, width: '100%', bg: 'red'}} />
}

export function MainWrapper({
  children,
  scrollable = false,
  ...props
}: YStackProps & {scrollable?: boolean}) {
  return (
    <XStack {...props} flex={1} h="100%" w="100%">
      {/* TODO: we cannot remove this ID here because the SlashMenu is referencing
      this! */}
      <YStack flex={1} h="100%">
        {scrollable ? (
          <ScrollView
            id="scroll-page-wrapper"
            scrollEventThrottle={1000}
            onScroll={() => {
              dispatchScroll('scroll')
            }}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </YStack>
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
      {children}
    </XStack>
  )
}
