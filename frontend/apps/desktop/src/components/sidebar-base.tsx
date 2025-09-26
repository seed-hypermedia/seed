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

import {useAppContext} from '@/app-context'
import {useStream} from '@shm/shared/use-stream'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {HMIcon} from '@shm/ui/hm-icon'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import useMedia from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {Plus, Settings} from 'lucide-react'
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

  const {platform} = useAppContext()

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
          className="absolute top-0 bottom-0 left-[-20px] z-50 rounded-lg bg-gray-100 opacity-0 hover:opacity-10 dark:bg-gray-900"
          style={{width: HoverRegionWidth + 20}}
          // onMouseEnter={ctx.onMenuHoverDelayed}
          // onMouseLeave={ctx.onMenuHoverLeave}
          onClick={ctx.onMenuHover}
        />
      ) : null}

      <Panel
        defaultSize={sidebarWidth}
        minSize={10}
        maxSize={30}
        ref={ref}
        collapsible
        id="sidebar"
        order={1}
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
            `flex h-full w-full flex-col pr-1 pl-3 transition-all duration-200 ease-in-out`,
            isLocked
              ? 'relative'
              : 'border-border bg-background absolute z-[51] rounded-tr-lg rounded-br-lg border shadow-lg dark:bg-black',
            isVisible ? 'opacity-100' : 'opacity-0',
          )}
          style={{
            transform: `translateX(${
              isVisible ? 0 : -SidebarWidth
            }px) translateY(${isLocked ? 0 : 40}px)`,
            maxWidth: isLocked ? undefined : SidebarWidth,
            top: isLocked ? undefined : platform === 'win32' ? 24 : 8,
            bottom: isLocked ? undefined : 8,
            height: isLocked ? '100%' : 'calc(100% - 60px)',
          }}
          // onMouseEnter={ctx.onMenuHover}
          // onMouseLeave={ctx.onMenuHoverLeave}
        >
          <div
            className={cn(
              'flex-1 overflow-y-auto pb-8',
              isLocked ? '' : 'py-2 pr-1',
            )}
          >
            {children}
          </div>
          <div
            className={cn(
              'flex w-full items-end',
              // isLocked ? '':'pb-2 pr-1',
            )}
          >
            <IdentitySelector isSidebarVisible={isVisible} />
          </div>
        </div>
      </Panel>
      {isLocked ? <PanelResizeHandle className="panel-resize-handle" /> : null}
    </>
  )
}

function IdentitySelector({
  isSidebarVisible = false,
}: {
  isSidebarVisible?: boolean
}) {
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = selectedIdentity
  const myAccounts = useMyAccounts()
  const accountOptions = myAccounts
    ?.map((a) => {
      const id = a.data?.id
      const doc = a.data?.type === 'document' ? a.data.document : undefined
      if (id) {
        return {
          id,
          metadata: doc?.metadata,
        }
      }
      return null
    })
    .filter((d) => {
      if (!d) return false
      if (typeof d.metadata === 'undefined') return false
      return true
    })

  useEffect(() => {
    // Check if current selected account is valid (exists in accountOptions)
    const isSelectedAccountValid = accountOptions?.some(
      (option) => option?.id.uid === selectedIdentityValue,
    )

    // Get the first valid account from the filtered options
    const firstValidAccount = accountOptions?.[0]?.id.uid

    // Set selected identity if:
    // 1. No account is selected, OR
    // 2. The selected account is not in the valid options list
    if (setSelectedIdentity && firstValidAccount) {
      if (!selectedIdentityValue || !isSelectedAccountValid) {
        setSelectedIdentity(firstValidAccount)
      }
    }
  }, [setSelectedIdentity, selectedIdentityValue, accountOptions])
  const selectedAccount = myAccounts?.find(
    (a) => a.data?.id?.uid === selectedIdentityValue,
  )
  const selectedAccountDoc =
    selectedAccount?.data?.type === 'document'
      ? selectedAccount.data.document
      : undefined
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (typeof isSidebarVisible == 'boolean' && isOpen && !isSidebarVisible) {
      setIsOpen(false)
    }
  }, [isSidebarVisible])

  if (!selectedIdentityValue) {
    return (
      <div className="flex w-full flex-row items-center justify-between gap-3 rounded-sm bg-white p-1 shadow-sm">
        <CreateAccountButton />
        <AppSettingsButton />
      </div>
    )
  }
  return (
    <div className="dark:bg-background border-border bg-background mb-2 flex w-full items-center rounded-md border transition-all duration-200 ease-in-out">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger className="flex w-full min-w-0 items-center justify-start gap-2 rounded-md bg-transparent px-1 py-1 pr-3">
          <>
            {/* <Button className="justify-start items-center pr-3 pl-2 w-full min-w-0 bg-transparent bg-blue-500 rounded-sm hover:bg-gray-200"> */}
            {selectedAccount?.data ? (
              <HMIcon
                key={selectedAccount.data?.id?.uid}
                id={selectedAccount.data?.id}
                name={selectedAccountDoc?.metadata?.name}
                icon={selectedAccountDoc?.metadata?.icon}
                size={24}
              />
            ) : null}

            <p className="truncate text-sm select-none">
              {selectedAccountDoc?.metadata?.name ||
                `?${selectedIdentityValue?.slice(-8) || 'Unknown'}`}
            </p>

            {/* </Button> */}
          </>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          className="z-[51] flex h-full max-h-[500px] flex-col items-stretch gap-2 p-2"
          align="end"
        >
          <ScrollArea className="h-full flex-1 overflow-y-auto">
            {accountOptions.map((option) =>
              option ? (
                <div
                  key={option.id.uid}
                  className={cn(
                    'hover:bg-sidebar-accent flex flex-row items-center gap-4 rounded-md p-2',
                    selectedAccount?.data?.id?.uid === option.id.uid
                      ? 'bg-sidebar-accent'
                      : '',
                  )}
                  onClick={() => {
                    setSelectedIdentity?.(option.id.uid || null)
                    setIsOpen(false)
                  }}
                >
                  {option.id ? (
                    <HMIcon
                      id={option?.id}
                      name={option?.metadata?.name}
                      icon={option?.metadata?.icon}
                    />
                  ) : null}
                  {option.metadata?.name}
                </div>
              ) : null,
            )}
          </ScrollArea>
          <CreateAccountButton />
        </PopoverContent>
      </Popover>
      <AppSettingsButton />
    </div>
  )
}

function CreateAccountButton({className}: {className?: string}) {
  return (
    <Button
      variant="default"
      className={cn('flex-1 border-none', className)}
      onClick={() => {
        dispatchOnboardingDialog(true)
      }}
    >
      <Plus className="size-4" />
      Create Account
    </Button>
  )
}

function AppSettingsButton() {
  const navigate = useNavigate()
  return (
    <Tooltip content="App Settings">
      <Button
        size="icon"
        className="hover:bg-muted active:bg-muted shrink-none flex h-8 w-8 items-center justify-center rounded-md"
        onClick={(e) => {
          e.preventDefault()
          navigate({key: 'settings'})
        }}
      >
        <Settings className="size-3" />
      </Button>
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
