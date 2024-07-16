import {ScrollView, SizableText, Tooltip, XStack, YStack} from '@shm/ui'
import {Allotment} from 'allotment'
import {ComponentProps} from 'react'
import {Button, useTheme} from 'tamagui'

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
    <Allotment.Pane preferredSize="35%" maxSize={400} minSize={300}>
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
    </Allotment.Pane>
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
    <Allotment defaultSizes={accessory ? [65, 35] : [100]}>
      <Allotment.Pane>
        <YStack height="100%">
          {children}
          <YStack position="absolute" right={0} top={0} padding="$3" gap="$2">
            {accessoryOptions.map((option) => {
              const isActive = accessoryKey === option.key
              return (
                <Tooltip key={option.key} content={option.label}>
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
        </YStack>
      </Allotment.Pane>
      {accessory}
    </Allotment>
  )
}
