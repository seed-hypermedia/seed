import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {ScrollView, XStack, YStack, YStackProps} from 'tamagui'

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
