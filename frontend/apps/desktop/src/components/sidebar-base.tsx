import {useMyAccounts} from '@/models/daemon'
import {SidebarWidth, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {useUniversalAppContext} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {HoverCard} from '@shm/ui/hover-card'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import useMedia from '@shm/ui/use-media'
import {useStream} from '@shm/ui/use-stream'
import {cn} from '@shm/ui/utils'
import {Settings} from '@tamagui/lucide-icons'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelResizeHandle,
} from 'react-resizable-panels'

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
              : 'absolute z-50 shadow-lg border border-gray-300 dark:border-gray-600 rounded-tr-lg rounded-br-lg bg-white dark:bg-black',
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
          <div className="flex justify-between p-2 shrink-0">
            <IdentitySelector />
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="panel-resize-handle" />
    </>
  )
}

function IdentitySelector() {
  const navigate = useNavigate()
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccounts = useMyAccounts()
  const accountOptions = myAccounts
    ?.map((a) => {
      const id = a.data?.id
      if (id) {
        return {
          label: a.data?.document?.metadata?.name || `?${id.uid?.slice(-8)}`,
          value: id.uid,
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
  if (!accountOptions?.length || !selectedIdentityValue || !selectedAccount) {
    return <CreateAccountButton />
  }
  return (
    <HoverCard
      placement="top-start"
      content={
        <div className="flex flex-col items-stretch items-center">
          {accountOptions.map((option) => (
            <div
              key={option.value}
              className={cn(
                'flex flex-row items-center gap-2 p-2 rounded-sm hover:bg-gray-100',
                selectedAccount?.data?.id?.uid === option.value
                  ? 'bg-blue-100 hover:bg-blue-200'
                  : '',
              )}
              onClick={() => {
                setSelectedIdentity?.(option.value || null)
              }}
            >
              {option.id ? (
                <HMIcon id={option?.id} metadata={option?.metadata} />
              ) : null}
              {option.label}
            </div>
          ))}
        </div>
      }
    >
      <div className="flex flex-row items-center justify-between p-4 bg-white rounded-sm">
        <div className="flex flex-row items-center gap-2">
          {selectedAccount.data ? (
            <HMIcon
              key={selectedAccount?.data?.id?.uid}
              id={selectedAccount?.data?.id}
              metadata={selectedAccount?.data?.document?.metadata}
            />
          ) : null}
          <div>{selectedAccount?.data?.document?.metadata?.name}</div>
        </div>
        <Tooltip content="App Settings">
          <Button
            size="$3"
            backgroundColor={'$colorTransparent'}
            chromeless
            onPress={() => {
              navigate({key: 'settings'})
            }}
            icon={Settings}
          />
        </Tooltip>
      </div>
    </HoverCard>
  )
}

function CreateAccountButton() {
  return <div>Create Account</div>
}

function IdentitySelectorSimple() {
  const navigate = useNavigate()
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccounts = useMyAccounts()
  const options = myAccounts
    ?.map((a) => {
      const id = a.data?.id
      if (id) {
        return {
          label: a.data?.document?.metadata?.name || `?${id.uid?.slice(-8)}`,
          value: id.uid,
        }
      }
      return null
    })
    .filter((d) => !!d)
  if (!options?.length || !selectedIdentityValue) {
    options.push({
      label: 'None',
      value: '',
    })
  }
  return (
    <div className="flex flex-row">
      <SelectDropdown
        options={options}
        value={selectedIdentityValue || ''}
        onValue={(value) => {
          setSelectedIdentity?.(value || null)
        }}
      />
      <Tooltip content="App Settings">
        <Button
          size="$3"
          backgroundColor={'$colorTransparent'}
          chromeless
          onPress={() => {
            navigate({key: 'settings'})
          }}
          icon={Settings}
        />
      </Tooltip>
    </div>
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
