import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
} from '@/utils/navigation'
import {DocAccessoryOption} from '@shm/shared'
import {PanelContainer} from '@shm/ui/container'
import {CollaboratorsIcon} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {FileClock, Folder, Pencil} from '@tamagui/lucide-icons'
import {ComponentProps, useEffect, useMemo, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {
  Button,
  ScrollView,
  SizableText,
  View,
  XGroup,
  XStack,
  YStack,
} from 'tamagui'

export function AccessoryLayout<Options extends AccessoryOptions>({
  children,
  accessory,
  accessoryKey,
  accessoryOptions,
  onAccessorySelect,
  mainPanelRef,
  isNewDraft = false,
}: {
  children: React.ReactNode
  accessory: React.ReactNode | null
  accessoryKey: Options[number]['key'] | undefined
  accessoryOptions: Options
  onAccessorySelect: (key: AccessoryOptions[number]['key'] | undefined) => void
  mainPanelRef?: React.RefObject<HTMLDivElement>
  isNewDraft?: boolean
}) {
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

  let accessoryTitle = 'Activity'
  if (accessoryKey == 'collaborators') {
    accessoryTitle = 'Collaborators'
  } else if (accessoryKey == 'directory') {
    accessoryTitle = 'Directory'
  } else if (accessoryKey == 'discussions') {
    accessoryTitle = 'Discussions'
  } else if (accessoryKey == 'options') {
    accessoryTitle = 'Draft Options'
  }

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
          <PanelContainer>
            <div
              ref={mainPanelRef}
              style={{flex: 1, height: '100%', overflow: 'hidden'}}
              onScroll={() => dispatchScroll(true)}
            >
              <View
                style={{
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  flex: 1,
                  height: '100%',
                }}
              >
                {children}
              </View>
            </div>
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
            onAccessorySelect={onAccessorySelect}
            padding={0}
            title={accessoryTitle}
            isNewDraft={isNewDraft}
          >
            {!isNewDraft &&
            accessoryKey != 'collaborators' &&
            accessoryKey !== 'directory' &&
            accessoryKey != 'options' ? (
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
    </XStack>
  )
}

export function AccessoryWrapper({
  children,
  title,
  onAccessorySelect,
  isNewDraft = false,
  ...props
}: {
  children?: React.ReactNode
  title?: string
  onAccessorySelect: (key: AccessoryOptions[number]['key'] | undefined) => void
  isNewDraft?: boolean
} & ComponentProps<typeof YStack>) {
  return (
    <PanelContainer {...props}>
      {title ? (
        <AccessoryTitle
          title={title}
          onAccessorySelect={onAccessorySelect}
          isNewDraft={isNewDraft}
        />
      ) : null}
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
    <YStack gap="$2" flex={1} {...props}>
      <ScrollView f={1} paddingHorizontal="$3">
        <YStack gap="$2">{children}</YStack>
      </ScrollView>
      {footer ? (
        <YStack borderTopWidth={1} borderColor="$color6">
          {footer}
        </YStack>
      ) : null}
    </YStack>
  )
}

export function AccessoryTitle({
  title,
  onAccessorySelect,
  isNewDraft = false,
}: {
  title: string
  onAccessorySelect: (key: AccessoryOptions[number]['key'] | undefined) => void
  isNewDraft?: boolean
}) {
  const route = useNavRoute()
  const docRoute = route.key == 'document' ? route : null
  const draftRoute = route.key == 'draft' ? route : null
  const activeKey = docRoute?.accessory?.key || draftRoute?.accessory?.key
  if (!activeKey) return null

  return (
    <XStack minHeight={56} ai="center" padding="$2">
      <SizableText
        userSelect="none"
        size="$3"
        fontWeight="600"
        paddingHorizontal="$1"
        f={1}
      >
        {title}
      </SizableText>
      {!isNewDraft && (
        <XGroup
          alignSelf="flex-start"
          borderColor="$borderColor"
          borderWidth={1}
          borderRadius="$2"
        >
          {route.key == 'draft' && (
            <XGroup.Item>
              <Tooltip content="Draft Options">
                <Button
                  borderRadius="$2"
                  bg={
                    activeKey == 'options'
                      ? '$brand11'
                      : '$backgroundTransparent'
                  }
                  size="$2"
                  icon={Pencil}
                  onPress={
                    activeKey != 'options'
                      ? () => onAccessorySelect('options')
                      : undefined
                  }
                />
              </Tooltip>
            </XGroup.Item>
          )}

          <XGroup.Item>
            <Tooltip content="Activity">
              <Button
                borderRadius="$2"
                bg={
                  activeKey == 'activity' ||
                  activeKey == 'discussions' ||
                  activeKey == 'citations' ||
                  activeKey == 'versions'
                    ? '$brand11'
                    : '$backgroundTransparent'
                }
                size="$2"
                icon={FileClock}
                onPress={
                  activeKey == 'collaborators' ||
                  activeKey == 'directory' ||
                  activeKey == 'options'
                    ? () => onAccessorySelect('discussions')
                    : undefined
                }
              />
            </Tooltip>
          </XGroup.Item>

          <XGroup.Item>
            <Tooltip content="Collaborators">
              <Button
                borderRadius="$2"
                bg={
                  activeKey == 'collaborators'
                    ? '$brand11'
                    : '$backgroundTransparent'
                }
                size="$2"
                icon={CollaboratorsIcon}
                onPress={
                  activeKey != 'collaborators'
                    ? () => onAccessorySelect('collaborators')
                    : undefined
                }
              />
            </Tooltip>
          </XGroup.Item>
          <XGroup.Item>
            <Tooltip content="Directory">
              <Button
                borderRadius="$2"
                bg={
                  activeKey == 'directory'
                    ? '$brand11'
                    : '$backgroundTransparent'
                }
                size="$2"
                icon={Folder}
                onPress={
                  activeKey != 'directory'
                    ? () => onAccessorySelect('directory')
                    : undefined
                }
              />
            </Tooltip>
          </XGroup.Item>
        </XGroup>
      )}
    </XStack>
  )
}

export function AccessorySection({
  children,
  title,
  onAccessorySelect,
}: {
  children: React.ReactNode
  title: string
  onAccessorySelect: (key: AccessoryOptions[number]['key'] | undefined) => void
}) {
  return (
    <YStack gap="$3">
      <AccessoryTitle title={title} onAccessorySelect={onAccessorySelect} />
      <YStack gap="$5">{children}</YStack>
    </YStack>
  )
}

function AccessoryTabs({
  options,
  accessoryKey,
  onAccessorySelect,
}: {
  accessoryKey: DocAccessoryOption['key'] | undefined
  options: DocAccessoryOption[]
  onAccessorySelect: (key: DocAccessoryOption['key'] | undefined) => void
}) {
  const _options = options.filter((o) => o.key != 'collaborators')
  return (
    <XStack gap="$3" paddingVertical="$2" paddingHorizontal="$3">
      {_options.map((option) => {
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
              <SizableText size="$1">{option.label}</SizableText>
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
