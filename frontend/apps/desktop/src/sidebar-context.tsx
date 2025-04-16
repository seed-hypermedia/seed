import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {useStream} from '@shm/ui/use-stream'
import {PropsWithChildren, createContext, useContext, useMemo} from 'react'
import {useNavigationDispatch, useNavigationState} from './utils/navigation'

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
  onSidebarResize: (width: number) => void
  widthStorage: {
    getItem: (name: string) => string
    setItem: (name: string, value: string) => void
  }
}

export const SidebarContext = createContext<SidebarContextValue | null>(null)

export const SidebarWidth = 220

export function SidebarContextProvider(props: PropsWithChildren<{}>) {
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()

  return (
    <SidebarContext.Provider
      value={useMemo(() => {
        const [setIsHoverVisible, isHoverVisible] =
          writeableStateStream<boolean>(false)
        const [setIsLocked, isLocked] = writeableStateStream<boolean>(
          typeof state?.sidebarLocked === 'boolean'
            ? state.sidebarLocked
            : true,
        )
        const [setSidebarWidth, sidebarWidth] = writeableStateStream<number>(
          state?.sidebarWidth || 15,
        )
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
          dispatch({type: 'sidebarLocked', value: true})
          setIsLocked(true)
        }
        function onCloseSidebar() {
          dispatch({type: 'sidebarLocked', value: false})
          setIsLocked(false)
          setIsHoverVisible(false)
        }
        function onSidebarResize(width: number) {
          dispatch({type: 'sidebarWidth', value: width})
          setSidebarWidth(width)
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
          onMenuHover,
          onMenuHoverDelayed,
          onMenuHoverLeave,
          onToggleMenuLock,
          onLockSidebarOpen,
          onCloseSidebar,
          onSidebarResize,
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
  if (!ctx)
    throw new Error(
      'useSidebarContext must be used within SidebarContextProvider',
    )
  return ctx
}

export function useSidebarWidth() {
  const sidebarContext = useSidebarContext()
  const sidebarWidth = useStream(sidebarContext.sidebarWidth)

  const minWidth = useMemo(() => {
    return `calc(${sidebarWidth}vw - 36px)`
  }, [sidebarWidth])

  return minWidth
}
