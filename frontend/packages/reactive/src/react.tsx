import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react'
import {acquireNode, NodeDef, NodeState} from './graph'
import {onEvent} from './event-bus'

export function useReactiveQuery<T>(def: NodeDef<T>): NodeState<T> {
  const handleRef = useRef<ReturnType<typeof acquireNode<T>> | null>(null)
  const sub = useMemo(() => {
    const h = acquireNode(def)
    handleRef.current = h
    return {
      subscribe: (cb: () => void) => {
        const unsub = h.state.subscribe(() => cb())
        return () => {
          unsub()
        }
      },
      getSnapshot: () => h.state.get(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key])

  useEffect(() => {
    return () => {
      handleRef.current?.release()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.key])

  return useSyncExternalStore(sub.subscribe, sub.getSnapshot, sub.getSnapshot)
}

export function useReactiveTopic(topic: string, handler: () => void): void {
  useEffect(() => {
    return onEvent(topic, handler)
  }, [topic, handler])
}
