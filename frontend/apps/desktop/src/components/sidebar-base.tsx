import {useMyAccounts} from '@/models/daemon'
import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {useUniversalAppContext} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {HMIcon} from '@shm/ui/hm-icon'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import useMedia from '@shm/ui/use-media'
import {useStream} from '@shm/ui/use-stream'
import {cn} from '@shm/ui/utils'
import {Settings} from '@tamagui/lucide-icons'
import {Plus} from 'lucide-react'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {dispatchOnboardingDialog} from './onboarding'

const HoverRegionWidth = 30

export function GenericSidebarContainer({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isFocused = useIsWindowFocused({
    onBlur: () => ctx.onMenuHoverLeave(),
  })
  const isWindowTooNarrowForHoverSidebar = useIsWindowNarrowForHoverSidebar()
  const isLocked = useStream(ctx.isLocked)

  const sidebarWidth = useStream(ctx.sidebarWidth)
  const isHoverVisible = useStream(ctx.isHoverVisible)
  const isVisible = isLocked || isHoverVisible
  const ref = useRef<ImperativePanelHandle>(null)
  const media = useMedia()

  const [wasLocked, setWasLocked] = useState(isLocked)

  const navigate = useNavigate()

  useEffect(() => {
    // this is needed to sync the panel size with the isLocked state
    const panel = ref.current
    if (!panel) return
    if (isLocked) {
      panel.resize(15)
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [isLocked])

  useEffect(() => {
    // This is needed to ensure the left sidebar is not visible on mobile. and if it was locked, it will be expanded when on desktop.
    if (media.gtSm) {
      const panel = ref.current
      if (!panel) return
      if (wasLocked) {
        panel.resize(sidebarWidth || 0)
        panel.expand()
      }
      if (!isLocked) {
        setWasLocked(false)
      }
    } else {
      if (isLocked) {
        setWasLocked(true)
      }
      const panel = ref.current
      if (!panel) return
      panel.collapse()
    }
  }, [media.gtSm, wasLocked, isLocked])

  return (
    <>
      {isFocused && !isLocked && !isWindowTooNarrowForHoverSidebar ? (
        <div
          className="absolute left-[-20px] rounded-lg bg-gray-100 dark:bg-gray-900 top-0 z-[900] opacity-0 hover:opacity-10 bottom-0"
          style={{width: HoverRegionWidth + 20}}
          onMouseEnter={ctx.onMenuHoverDelayed}
          onMouseLeave={ctx.onMenuHoverLeave}
          onClick={ctx.onMenuHover}
        />
      ) : null}

      <Panel
        defaultSize={sidebarWidth}
        minSize={10}
        maxSize={20}
        ref={ref}
        collapsible
        id="sidebar"
        className="h-full"
        onCollapse={() => {
          ctx.onCloseSidebar()
        }}
        onResize={(size) => {
          ctx.onSidebarResize(size)
        }}
        onExpand={() => {
          ctx.onLockSidebarOpen()
        }}
      >
        <div
          className={cn(
            `w-full flex flex-col transition-all duration-200 ease-in-out h-full px-3`,
            isLocked
              ? 'relative'
              : 'absolute z-50 shadow-lg border border-border rounded-tr-lg rounded-br-lg bg-background',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translateX(${
              isVisible ? 0 : -SidebarWidth
            }px) translateY(${isLocked ? 0 : 40}px)`,
            maxWidth: isLocked ? undefined : SidebarWidth,
            top: isLocked ? undefined : 8,
            bottom: isLocked ? undefined : 8,
            height: isLocked ? '100%' : 'calc(100% - 60px)',
          }}
          onMouseEnter={ctx.onMenuHover}
          onMouseLeave={ctx.onMenuHoverLeave}
        >
          <div className="flex-1 pt-2 pb-8 overflow-y-auto ">{children}</div>
          <div className="flex justify-between shrink-0">
            <IdentitySelector />
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="panel-resize-handle" />
    </>
  )
}

function IdentitySelector() {
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccounts = useMyAccounts()
  const accountOptions = myAccounts
    ?.map((a) => {
      const id = a.data?.id
      if (id) {
        return {
          id,
          metadata: a.data?.document?.metadata,
        }
      }
      return null
    })
    .filter((d) => !!d)
  useEffect(() => {
    const firstValidAccount = myAccounts?.find((a) => !!a.data?.id?.uid)?.data
      ?.id?.uid
    if (setSelectedIdentity && !selectedIdentityValue && firstValidAccount) {
      setSelectedIdentity(firstValidAccount)
    }
  }, [setSelectedIdentity, selectedIdentityValue, myAccounts])
  const selectedAccount = myAccounts?.find(
    (a) => a.data?.id?.uid === selectedIdentityValue,
  )
  const [isOpen, setIsOpen] = useState(false)

  if (!selectedIdentityValue) {
    return (
      <div className="flex flex-row items-center justify-between w-full gap-3 p-1 bg-white rounded-sm shadow-sm">
        <CreateAccountButton />
        <AppSettingsButton />
      </div>
    )
  }
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button className="flex flex-row items-center justify-between w-full p-1 transition bg-white rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 border-1 dark:bg-neutral-900">
          <div className="flex flex-row items-center gap-2">
            {selectedAccount?.data ? (
              <HMIcon
                key={selectedAccount.data?.id?.uid}
                id={selectedAccount.data?.id}
                metadata={selectedAccount.data?.document?.metadata}
                size={28}
              />
            ) : null}
            <div className="text-sm line-clamp-1">
              {selectedAccount?.data?.document?.metadata?.name ||
                `?${selectedIdentityValue.slice(-8)}`}
            </div>
          </div>
          <AppSettingsButton />
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col items-stretch gap-1 max-h-[80vh] overflow-y-auto">
        {accountOptions.map((option) => (
          <div
            key={option.id.uid}
            className={cn(
              'flex flex-row items-center gap-4 p-2 rounded-sm hover:bg-gray-100 dark:hover:bg-neutral-900',
              selectedAccount?.data?.id?.uid === option.id.uid
                ? 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-950 dark:hover:bg-blue-900'
                : '',
            )}
            onClick={() => {
              setSelectedIdentity?.(option.id.uid || null)
              setIsOpen(false)
            }}
          >
            {option.id ? (
              <HMIcon id={option?.id} metadata={option?.metadata} />
            ) : null}
            {option.metadata?.name}
          </div>
        ))}
        <CreateAccountButton className="mt-3" />
      </PopoverContent>
    </Popover>
  )
}

function CreateAccountButton({className}: {className?: string}) {
  return (
    <Button
      className={cn('flex-1', className)}
      backgroundColor="$brand5"
      hoverStyle={{backgroundColor: '$brand4'}}
      pressStyle={{backgroundColor: '$brand3'}}
      borderWidth={0}
      color="white"
      size="$2"
      icon={Plus}
      onPress={() => {
        dispatchOnboardingDialog(true)
      }}
    >
      Create Account
    </Button>
  )
}

function AppSettingsButton() {
  const navigate = useNavigate()
  return (
    <Tooltip content="App Settings">
      <button
        className="flex items-center justify-center w-8 h-8 rounded-sm hover:bg-gray-200 dark:hover:bg-gray-800"
        onClick={(e) => {
          e.preventDefault()
          navigate({key: 'settings'})
        }}
      >
        <Settings size={16} />
      </button>
    </Tooltip>
  )
}

export const useIsWindowFocused = ({
  onFocus,
  onBlur,
}: {
  onFocus?: () => void
  onBlur?: () => void
}): boolean => {
  const [isFocused, setIsFocused] = useState(document.hasFocus())
  useEffect(() => {
    const handleFocus = () => {
      onFocus?.()
      setIsFocused(true)
    }
    const handleBlur = () => {
      onBlur?.()
      setIsFocused(false)
    }
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])
  return isFocused
}

function useIsWindowNarrowForHoverSidebar() {
  const [
    isWindowTooNarrowForHoverSidebar,
    setIsWindowTooNarrowForHoverSidebar,
  ] = useState(window.innerWidth < 820)
  useEffect(() => {
    const handleResize = () => {
      setIsWindowTooNarrowForHoverSidebar(window.innerWidth < 820)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  return isWindowTooNarrowForHoverSidebar
}

export function SidebarDivider() {
  return <Separator className="my-2" />
}
