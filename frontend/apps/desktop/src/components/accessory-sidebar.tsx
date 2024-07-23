import {ScrollView, SizableText, Tooltip, XStack, YStack} from '@shm/ui'
import {X} from '@tamagui/lucide-icons'
import {ComponentProps} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {Button, useTheme} from 'tamagui'

const CloseButtonSize = 40

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
    <YStack height="100%" {...props} paddingVertical="$3">
      <YStack f={1} backgroundColor="$color4" borderRadius="$4">
        <XStack
          paddingVertical="$2"
          borderBottomColor="$color7"
          borderBottomWidth={1}
          alignItems="center"
        >
          {title ? (
            <SizableText
              userSelect="none"
              f={1}
              fontSize="$6"
              marginHorizontal="$4"
            >
              {title}
            </SizableText>
          ) : null}
          <Button
            icon={X}
            onPress={onClose}
            size="$2"
            padding="$3"
            marginRight="$2"
            chromeless
            width={CloseButtonSize}
            height={CloseButtonSize}
            borderRadius={CloseButtonSize / 2}
          />
        </XStack>
        <ScrollView f={1}>
          <YStack>{children}</YStack>
        </ScrollView>
        {footer}
      </YStack>
    </YStack>
  )
}

const AccessoryButtonSize = 50

export function AccessoryLayout<
  Options extends {
    key: string
    label: string
    icon?: null | React.FC<{color: string}>
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
        <Panel minSize={50}>
          <XStack>
            <YStack f={1}>{children}</YStack>
          </XStack>
        </Panel>
        <PanelResizeHandle style={{width: 4}} />
        <Panel
          hidden={accessoryKey === undefined}
          maxSize={50}
          minSize={20}
          defaultSize={20}
        >
          {accessory}
        </Panel>
      </PanelGroup>
      <YStack padding="$3" gap="$2">
        {accessoryOptions.map((option) => {
          const isActive = accessoryKey === option.key
          return (
            <Tooltip key={option.key} placement="left" content={option.label}>
              <Button
                size="$2"
                backgroundColor={isActive ? theme.blue10.val : theme.color1.val}
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
    </XStack>
  )
}
