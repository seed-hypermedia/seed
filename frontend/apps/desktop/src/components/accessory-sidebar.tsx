import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
} from '@/utils/navigation'
import {defaultContainerStyle, PanelContainer} from '@shm/ui/container'
import {ComponentProps, useEffect, useMemo, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Button, ScrollView, SizableText, View, XStack, YStack} from 'tamagui'

export function AccessoryWrapper({
  children,
  title,
  ...props
}: {
  children?: React.ReactNode
  title?: string
} & ComponentProps<typeof YStack>) {
  return (
    <PanelContainer {...props}>
      {title ? <AccessoryTitle title={title} /> : null}
      <YStack flex={1} gap="$3">
        {children}
      </YStack>
    </PanelContainer>
  )
}

export function AccessoryContent({
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
    <YStack gap="$2" flex={1}>
      <ScrollView f={1} paddingHorizontal="$3">
        {children}
      </ScrollView>
      {footer ? (
        <YStack borderTopWidth={1} borderColor="$color6">
          {footer}
        </YStack>
      ) : null}
    </YStack>
  )
}

export function AccessoryTitle({title}: {title: string}) {
  return (
    <XStack minHeight={40} ai="center" paddingHorizontal="$3">
      <SizableText userSelect="none" size="$3" fontWeight="600">
        {title}
      </SizableText>
    </XStack>
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

type AccessoryOptions = Array<{
  key: string
  label: string
  icon?: null | React.FC<{color: string; size?: number}>
}>

export function AccessoryLayout<Options extends AccessoryOptions>({
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
  const route = useNavRoute()
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accesoryPanelRef = useRef<ImperativePanelHandle>(null)
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()

  const widthStorage = useMemo(
    () => ({
      getItem(name: string) {
        try {
          return String(state?.accessoryWidth || 0)
        } catch (e) {
          console.error('Error getting sidebar width from storage', {e})
          return '0'
        }
      },
      setItem(name: string, value: string) {
        console.log('setItem', {name, value})
        try {
          const data = JSON.parse(value)
          // Extract the first value from the layout array which represents the sidebar width percentage
          const accessoryWidth = data['accessory,main']?.layout[1]

          if (typeof accessoryWidth === 'number') {
            dispatch({type: 'accessoryWidth', value: accessoryWidth})
          }
        } catch (e) {
          console.error('Error setting sidebar width in storage', {e})
        }
      },
    }),
    [state?.sidebarLocked, state?.accessoryWidth],
  )

  useEffect(() => {
    const panelGroup = panelsRef.current
    if (panelGroup) {
      if (state?.accessoryWidth && state?.accessoryWidth > 0) {
        panelGroup.setLayout([
          100 - state?.accessoryWidth,
          state?.accessoryWidth,
        ])
      } else {
        panelGroup.setLayout([100, 0])
      }
    }
  }, [state?.accessoryWidth])

  return (
    <XStack f={1} height="100%">
      <PanelGroup
        direction="horizontal"
        ref={panelsRef}
        style={{flex: 1}}
        autoSaveId="accessory"
        storage={widthStorage}
      >
        <Panel
          id="main"
          minSize={50}
          style={{
            overflow: 'hidden',
          }}
        >
          <PanelContainer
            $gtSm={{
              ...defaultContainerStyle,
              marginLeft: 8,
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
          id="accessory"
          ref={accesoryPanelRef}
          maxSize={50}
          minSize={20}
          defaultSize={state?.accessoryWidth || 20}
          onResize={(size) => {
            dispatch({type: 'accessoryWidth', value: size})
          }}
        >
          <AccessoryWrapper
            padding={0}
            title={route.key == 'document' ? 'Activity' : 'Document Options'}
            $gtSm={{
              ...defaultContainerStyle,
              w: 'calc(100% - 8px)',
              padding: 0,
            }}
          >
            {route.key == 'document' ? (
              <AccessoryTabs
                options={accessoryOptions}
                accessoryKey={accessoryKey}
                onAccessorySelect={onAccessorySelect}
              />
            ) : null}
            {accessory}
          </AccessoryWrapper>
        </Panel>
      </PanelGroup>
      {/* <YStack>
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
      </YStack> */}
    </XStack>
  )
}

function AccessoryTabs({
  options,
  accessoryKey,
  onAccessorySelect,
}: {
  accessoryKey: AccessoryOptions[number]['key'] | undefined
  options: AccessoryOptions
  onAccessorySelect: (key: AccessoryOptions[number]['key'] | undefined) => void
}) {
  return (
    <XStack gap="$3" paddingVertical="$2" paddingHorizontal="$3">
      {options.map((option) => {
        const isActive = accessoryKey === option.key
        return (
          <Button
            size="$1"
            borderRadius={0}
            bg="$backgroundTransparent"
            hoverStyle={{
              backgroundColor: '$backgroundTransparent',
              borderColor: '$colorTransparent',
            }}
            focusStyle={{
              backgroundColor: '$backgroundTransparent',
              borderColor: '$colorTransparent',
            }}
            outlineColor="$colorTransparent"
            borderColor="$colorTransparent"
            onPress={() => {
              if (isActive) return
              // if (isActive) onAccessorySelect(undefined)
              onAccessorySelect(option.key)
            }}
            padding={0}
          >
            <YStack gap="$1">
              <SizableText size="$1">{option.key}</SizableText>
              <XStack
                w="100%"
                h={2}
                bg={isActive ? '$color' : '$backgroundTransparent'}
              />
            </YStack>
          </Button>
        )
      })}
    </XStack>
  )
}
