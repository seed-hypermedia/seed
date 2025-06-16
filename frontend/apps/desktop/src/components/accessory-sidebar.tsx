import {
  useNavigationDispatch,
  useNavigationState,
  useNavRoute,
} from '@/utils/navigation'
import {DocAccessoryOption} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/components/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles} from '@shm/ui/container'
import {BlockQuote, CollaboratorsIcon} from '@shm/ui/icons'
import {SizableText, Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
  Clock,
  FileClock,
  Folder,
  MessageSquare,
  Pencil,
  Sparkle,
  Users,
} from 'lucide-react'
import {useEffect, useMemo, useRef} from 'react'
import {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {XGroup, XStack, YStack} from 'tamagui'

export function AccessoryLayout<Options extends DocAccessoryOption[]>({
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
  onAccessorySelect: (key: Options[number]['key'] | undefined) => void
  mainPanelRef?: React.RefObject<HTMLDivElement>
  isNewDraft?: boolean
}) {
  const panelsRef = useRef<ImperativePanelGroupHandle>(null)
  const accesoryPanelRef = useRef<ImperativePanelHandle>(null)
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  const tx = useTx()

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

  let accessoryTitle = tx('Activity')
  if (accessoryKey == 'collaborators') {
    accessoryTitle = tx('Collaborators')
  } else if (accessoryKey == 'directory') {
    accessoryTitle = tx('Directory')
  } else if (accessoryKey == 'discussions') {
    accessoryTitle = tx('Discussions')
  } else if (accessoryKey == 'options') {
    accessoryTitle = tx('Draft Options')
  } else if (accessoryKey == 'versions') {
    accessoryTitle = tx('Versions')
  } else if (accessoryKey == 'citations') {
    accessoryTitle = tx('Citations')
  } else if (accessoryKey == 'activity') {
    accessoryTitle = tx('All')
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
        <Panel id="main" minSize={50} className="overflow-hidden px-2">
          {children}
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
          className="px-2"
        >
          <div
            className={cn(
              panelContainerStyles,
              'bg-white dark:bg-black flex flex-col',
            )}
          >
            <AccessoryTabs
              options={accessoryOptions}
              accessoryKey={accessoryKey}
              onAccessorySelect={onAccessorySelect}
            />
            <div className="py-3 px-5 border-b border-border">
              <Text weight="semibold" size="lg">
                {accessoryTitle}
              </Text>
            </div>
            {accessory}
          </div>
        </Panel>
      </PanelGroup>
    </XStack>
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
}) {
  return (
    <div className="flex flex-col flex-1" {...props}>
      <ScrollArea className="flex-1 h-full px-3">
        <YStack gap="$2">{children}</YStack>
      </ScrollArea>
      {footer ? (
        <YStack borderTopWidth={1} borderColor="$color6">
          {footer}
        </YStack>
      ) : null}
    </div>
  )
}

export function AccessoryTitle({
  title,
  onAccessorySelect,
  isNewDraft = false,
}: {
  title: string
  onAccessorySelect: (key: DocAccessoryOption['key'] | undefined) => void
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
      {!isNewDraft && onAccessorySelect && (
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
                  size="icon"
                  variant={activeKey == 'options' ? 'brand' : 'ghost'}
                  onClick={
                    activeKey != 'options'
                      ? () => onAccessorySelect('options')
                      : undefined
                  }
                >
                  <Pencil size={16} className="size-4" />
                </Button>
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
                icon={<CollaboratorsIcon size={16} />}
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
  onAccessorySelect: (key: DocAccessoryOption['key'] | undefined) => void
}) {
  return (
    <YStack gap="$3">
      <AccessoryTitle title={title} onAccessorySelect={onAccessorySelect} />
      <YStack gap="$5">{children}</YStack>
    </YStack>
  )
}

const iconNames = {
  activity: Sparkle,
  collaborators: Users,
  directory: Folder,
  discussions: MessageSquare,
  options: Pencil,
  versions: Clock,
  citations: BlockQuote,
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
  return (
    <div className="gap-1 p-2 px-3 flex items-center justify-center">
      {options.map((option) => {
        const isActive = accessoryKey === option.key
        const Icon = accessoryKey ? iconNames[option.key] : undefined
        return (
          <Tooltip content={option.label}>
            <span>
              <Button
                size="sm"
                variant={isActive ? 'brand-12' : 'ghost'}
                onClick={() => {
                  if (isActive) return
                  // if (isActive) onAccessorySelect(undefined)
                  onAccessorySelect(option.key)
                }}
              >
                {Icon ? <Icon className="size-4" /> : null}
              </Button>
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}
