import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {defaultContainerStyle, PanelContainer} from '@shm/ui/container'
import {Tooltip} from '@shm/ui/tooltip'
import {ComponentProps} from 'react'
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {
  Button,
  ScrollView,
  SizableText,
  useTheme,
  View,
  XStack,
  YStack,
} from 'tamagui'

export function AccessoryContainer({
  children,
  footer,
  title,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  title?: string
  onClose?: () => void
} & ComponentProps<typeof YStack>) {
  return (
    <PanelContainer
      width="100%"
      $gtSm={{...defaultContainerStyle, marginHorizontal: 0, w: '100%'}}
      margin={0}
      {...props}
    >
      <ScrollView f={1}>
        <YStack paddingVertical="$3" paddingHorizontal="$3" gap="$3">
          {title ? <AccessoryTitle title={title} /> : null}
          <YStack gap="$5">{children}</YStack>
        </YStack>
      </ScrollView>
      <YStack borderTopWidth={1} borderColor="$color6">
        {footer}
      </YStack>
    </PanelContainer>
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

const AccessoryButtonSize = 40

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
            overflow: 'hidden',
          }}
        >
          <PanelContainer
            $gtSm={{
              ...defaultContainerStyle,
              w:
                accessoryKey == undefined
                  ? 'calc(100% - 8px)'
                  : 'calc(100% - 12px)',
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
          </PanelContainer>
        </Panel>
        {accessoryKey !== undefined ? (
          <PanelResizeHandle className="panel-resize-handle" />
        ) : null}
        <Panel
          hidden={accessoryKey === undefined}
          maxSize={50}
          minSize={20}
          defaultSize={20}
          style={{
            overflowY: 'auto',
            paddingLeft: 4,
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
                size="$3"
                bg="$backgroundTransparent"
                hoverStyle={{
                  backgroundColor: '$backgroundTransparent',
                  borderColor: '$colorTransparent',
                }}
                focusStyle={{
                  backgroundColor: '$backgroundTransparent',
                  borderColor: '$colorTransparent',
                }}
                onPress={() => {
                  if (isActive) onAccessorySelect(undefined)
                  else onAccessorySelect(option.key)
                }}
                width={AccessoryButtonSize}
                height={AccessoryButtonSize}
                padding={0}
                outlineColor="$colorTransparent"
                borderColor="$colorTransparent"
              >
                {option.icon ? (
                  <option.icon
                    size={20}
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
