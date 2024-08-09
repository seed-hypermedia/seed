import {ScrollView, SizableText, Tooltip, XStack, YStack} from '@shm/ui'
import {ComponentProps} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {Button, useTheme} from 'tamagui'

export function AccessoryContainer({
  children,
  footer,
  title,
  onClose,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  title?: string
  onClose?: () => void
} & ComponentProps<typeof YStack>) {
  return (
    <YStack
      height="100%"
      {...props}
      paddingVertical="$3"
      backgroundColor="$color4"
    >
      {title ? (
        <SizableText
          userSelect="none"
          f={1}
          size="$3"
          fontWeight="600"
          marginHorizontal="$4"
        >
          {title}
        </SizableText>
      ) : null}
      <YStack f={1} borderRadius="$4">
        <ScrollView f={1}>
          <YStack>{children}</YStack>
        </ScrollView>
        {footer}
      </YStack>
    </YStack>
  )
}

const AccessoryButtonSize = 60

export function AccessoryLayout<
  Options extends {
    key: string
    label: string
    icon?: null | React.FC<{color: string; size?: number}>
  }[],
>({
  children,
  accessory,
  accessoryKey,
  accessoryOptions,
  onAccessorySelect,
}: {
  children: React.ReactNode
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  accessoryOptions: Options
  onAccessorySelect: (key: Options[number]['key'] | undefined) => void
}) {
  const theme = useTheme()
  return (
    <XStack f={1}>
      <PanelGroup direction="horizontal">
        <Panel
          minSize={50}
          style={{overflowY: 'scroll', borderRight: '1px solid var(--color7)'}}
        >
          {children}
        </Panel>
        <PanelResizeHandle />
        <Panel
          hidden={accessoryKey === undefined}
          maxSize={50}
          minSize={20}
          defaultSize={20}
          style={{
            overflowY: 'scroll',
            borderRight:
              accessoryKey === undefined
                ? undefined
                : '1px solid var(--color7)',
          }}
        >
          {accessory}
        </Panel>
      </PanelGroup>
      <YStack>
        {accessoryOptions.map((option) => {
          const isActive = accessoryKey === option.key
          return (
            <Tooltip key={option.key} placement="left" content={option.label}>
              <Button
                size="$4"
                // hoverStyle={{
                //   backgroundColor: isActive
                //     ? theme.blue10.val
                //     : theme.color2.val,
                // }}
                onPress={() => {
                  onAccessorySelect(option.key)
                }}
                width={AccessoryButtonSize}
                height={AccessoryButtonSize}
                padding={0}
                outlineColor="$colorTransparent"
                borderColor="$colorTransparent"
                hoverStyle={{
                  borderColor: '$colorTransparent',
                }}
              >
                {option.icon ? (
                  <option.icon
                    size={32}
                    color={isActive ? theme.blue10.val : theme.color.val}
                  />
                ) : null}
              </Button>
            </Tooltip>
          )
        })}
      </YStack>
    </XStack>
  )
}
