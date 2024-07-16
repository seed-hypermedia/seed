import {ScrollView, SizableText, Tooltip, XStack, YStack} from '@shm/ui'
import {ComponentProps} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {Button, useTheme, View} from 'tamagui'

export function AccessoryContainer({
  children,
  footer,
  title,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  title?: string
} & ComponentProps<typeof YStack>) {
  return (
    <YStack height="100%" {...props}>
      {title ? (
        <XStack
          paddingHorizontal="$4"
          paddingVertical="$3"
          borderBottomColor="$borderColor"
          borderBottomWidth={1}
        >
          <SizableText userSelect="none">{title}</SizableText>
        </XStack>
      ) : null}
      <ScrollView f={1}>
        <YStack>{children}</YStack>
      </ScrollView>
      {footer}
    </YStack>
  )
}

const AccessoryButtonSize = 50

export function AccessoryLayout<
  Options extends {
    key: string
    label: string
    icon?: React.FC<{color: string}>
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
    <PanelGroup direction="horizontal">
      <Panel minSize={50}>
        <View position="relative">
          {children}
          <YStack position="absolute" right={0} top={0} padding="$3" gap="$2">
            {accessoryOptions.map((option) => {
              const isActive = accessoryKey === option.key
              return (
                <Tooltip
                  key={option.key}
                  placement="left"
                  content={option.label}
                >
                  <Button
                    size="$2"
                    backgroundColor={
                      isActive ? theme.blue10.val : theme.color1.val
                    }
                    hoverStyle={{
                      backgroundColor: isActive
                        ? theme.blue10.val
                        : theme.color2.val,
                    }}
                    onPress={() => {
                      onAccessorySelect(option.key)
                    }}
                    width={AccessoryButtonSize}
                    height={AccessoryButtonSize}
                    borderRadius={AccessoryButtonSize / 2}
                  >
                    {option.icon ? (
                      <option.icon
                        color={isActive ? theme.color1.val : theme.color12.val}
                      />
                    ) : null}
                  </Button>
                </Tooltip>
              )
            })}
          </YStack>
        </View>
      </Panel>
      {accessory ? (
        <>
          <PanelResizeHandle
            style={{backgroundColor: theme.color6.val, width: 4}}
          />
          <Panel maxSize={50} minSize={10} defaultSize={20}>
            {accessory}
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  )
}
