import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {
  Button,
  ScrollView,
  SizableText,
  Tooltip,
  useTheme,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {ComponentProps} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'

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
    <YStack height="100%" {...props} backgroundColor="$color4" gap="$4">
      <ScrollView f={1}>
        <YStack paddingVertical="$3" paddingHorizontal="$4" gap="$4">
          {title ? <AccessoryTitle title={title} /> : null}
          <YStack gap="$5">{children}</YStack>
          {footer}
        </YStack>
      </ScrollView>
    </YStack>
  )
}

export function AccessoryTitle({title}: {title: string}) {
  return (
    <SizableText userSelect="none" size="$3" fontWeight="600">
      {title}
    </SizableText>
  )
}

export function AccessorySection({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <YStack gap="$3">
      <AccessoryTitle title={title} />
      <YStack gap="$5">{children}</YStack>
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
  mainPanelRef,
}: {
  children: React.ReactNode
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  accessoryOptions: Options
  onAccessorySelect: (key: Options[number]['key'] | undefined) => void
  mainPanelRef?: React.RefObject<HTMLDivElement>
}) {
  const theme = useTheme()
  return (
    <XStack f={1} height="100%">
      <PanelGroup direction="horizontal">
        <Panel
          minSize={50}
          style={{
            borderRight: '1px solid var(--color7)',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              overflowY: 'auto',
              overflowX: 'hidden',
              flex: 1,
              height: '100%',
            }}
            ref={mainPanelRef}
            onScroll={() => {
              dispatchScroll(true)
            }}
          >
            {children}
          </View>
        </Panel>
        {accessoryKey !== undefined ? (
          <PanelResizeHandle className="accessory-resize-handle" />
        ) : null}
        <Panel
          hidden={accessoryKey === undefined}
          maxSize={50}
          minSize={20}
          defaultSize={20}
          style={{
            overflowY: 'auto',
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
                  if (isActive) onAccessorySelect(undefined)
                  else onAccessorySelect(option.key)
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
                    size={28}
                    color={isActive ? theme.brand5.val : theme.color.val}
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
