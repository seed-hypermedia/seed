import {useStream} from '@shm/shared/use-stream'
import {useNavigationDispatch, useNavigationState} from '@shm/shared/utils/navigation'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {PropsWithChildren, createContext, useContext, useMemo} from 'react'

type SidebarContextValue = {
  onMenuHover: () => void
  onMenuHoverDelayed: () => void
  onMenuHoverLeave: () => void
  onToggleMenuLock: () => void
  onLockSidebarOpen: () => void
  onCloseSidebar: () => void
  isHoverVisible: StateStream<boolean>
  isLocked: StateStream<boolean>
  sidebarWidth: StateStream<number>
  sidebarWidthPx: StateStream<number | null>
  onSidebarResize: (width: number) => void
  onSidebarWidthPxChange: (width: number) => void
  widthStorage: {
    getItem: (name: string) => string
    setItem: (name: string, value: string) => void
  }
}

export const SidebarContext = createContext<SidebarContextValue | null>(null)

export const SidebarWidth = 220

export function getSidebarTitlebarWidth({
  isLocked,
  sidebarWidthPx,
}: {
  isLocked: boolean
  sidebarWidthPx: number | null | undefined
}) {
  if (!isLocked || !sidebarWidthPx || sidebarWidthPx <= 0) return undefined
  return `${Math.round(sidebarWidthPx)}px`
}

export function SidebarContextProvider(props: PropsWithChildren<{}>) {
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()

  return (
    <SidebarContext.Provider
      value={useMemo(() => {
        const [setIsHoverVisible, isHoverVisible] = writeableStateStream<boolean>(false)
        const [setIsLocked, isLocked] = writeableStateStream<boolean>(
          typeof state?.sidebarLocked === 'boolean' ? state.sidebarLocked : true,
        )
        const [setSidebarWidth, sidebarWidth] = writeableStateStream<number>(state?.sidebarWidth || 15)
        const [setSidebarWidthPx, sidebarWidthPx] = writeableStateStream<number | null>(null)
        let closeTimeout: null | NodeJS.Timeout = null
        let hoverOpenTimeout: null | NodeJS.Timeout = null
        function onMenuHover() {
          closeTimeout && clearTimeout(closeTimeout)
          setIsHoverVisible(true)
        }
        function onMenuHoverDelayed() {
          closeTimeout && clearTimeout(closeTimeout)
          hoverOpenTimeout && clearTimeout(hoverOpenTimeout)
          hoverOpenTimeout = setTimeout(() => {
            hoverOpenTimeout && clearTimeout(hoverOpenTimeout)
            closeTimeout && clearTimeout(closeTimeout)
            setIsHoverVisible(true)
          }, 300)
        }
        function onMenuHoverLeave() {
          hoverOpenTimeout && clearTimeout(hoverOpenTimeout)
          closeTimeout = setTimeout(() => {
            setIsHoverVisible(false)
          }, 250)
        }
        function onToggleMenuLock() {
          const wasLocked = isLocked.get()
          const nextIsLocked = !wasLocked
          dispatch({type: 'sidebarLocked', value: nextIsLocked})
          setIsLocked(nextIsLocked)
        }
        function onLockSidebarOpen() {
          const currentState = isLocked.get()
          // Only update if not already locked
          if (!currentState) {
            dispatch({type: 'sidebarLocked', value: true})
            setIsLocked(true)
          }
        }
        function onCloseSidebar() {
          const currentState = isLocked.get()
          // Only update if currently locked
          if (currentState) {
            dispatch({type: 'sidebarLocked', value: false})
            setIsLocked(false)
            setIsHoverVisible(false)
          }
        }
        function onSidebarResize(width: number) {
          dispatch({type: 'sidebarWidth', value: width})
          setSidebarWidth(width)
        }
        function onSidebarWidthPxChange(width: number) {
          setSidebarWidthPx(width)
        }

        const widthStorage = {
          getItem(name: string) {
            try {
              if (state?.sidebarLocked) {
                return '0'
              }
              return String(state?.sidebarWidth || 0)
            } catch (e) {
              console.error('Error getting sidebar width from storage', {e})
              return '0'
            }
          },
          setItem(name: string, value: string) {
            try {
              const data = JSON.parse(value)
              // Extract the first value from the layout array which represents the sidebar width percentage
              const sidebarWidth = data['page,sidebar']?.layout[0]

              if (typeof sidebarWidth === 'number') {
                dispatch({type: 'sidebarWidth', value: sidebarWidth})
                setSidebarWidth(sidebarWidth)
              }
            } catch (e) {
              console.error('Error setting sidebar width in storage', {e})
            }
          },
        }

        return {
          isHoverVisible,
          isLocked,
          sidebarWidth,
          sidebarWidthPx,
          onMenuHover,
          onMenuHoverDelayed,
          onMenuHoverLeave,
          onToggleMenuLock,
          onLockSidebarOpen,
          onCloseSidebar,
          onSidebarResize,
          onSidebarWidthPxChange,
          widthStorage,
        }
      }, [])}
    >
      {props.children}
    </SidebarContext.Provider>
  )
}

export function useSidebarContext() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebarContext must be used within SidebarContextProvider')
  return ctx
}

export function useSidebarWidth() {
  const sidebarContext = useSidebarContext()
  const isLocked = !!useStream(sidebarContext.isLocked)
  const sidebarWidthPx = useStream(sidebarContext.sidebarWidthPx)

  const minWidth = useMemo(() => {
    return getSidebarTitlebarWidth({isLocked, sidebarWidthPx})
  }, [isLocked, sidebarWidthPx])

  return minWidth
}
