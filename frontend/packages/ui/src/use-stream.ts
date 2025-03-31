import type {StateStream} from '@shm/shared'
import {useEffect, useState, useSyncExternalStore} from 'react'

export function useStream<StreamValue>(
  stream?: StateStream<StreamValue> | undefined,
): StreamValue | undefined {
  return useSyncExternalStore(
    (onStoreChange) => {
      return stream ? stream.subscribe(onStoreChange) : () => {}
    },
    () => stream?.get(),
  )
}

export function useStreamSelector<StreamValue, SelectedValue>(
  stream: StateStream<StreamValue>,
  selector: (
    value: StreamValue,
    previousSelectedValue: SelectedValue | undefined,
  ) => SelectedValue,
  debugFlag?: string,
): SelectedValue {
  const [state, setState] = useState<SelectedValue>(
    selector(stream.get(), undefined),
  )
  useEffect(() => {
    return stream.subscribe(() => {
      debugFlag &&
        console.log('~~ useStreamSelector update', stream.get(), debugFlag)
      setState((previousSelectedValue) => {
        // console.log('~~ useStreamSelector update', stream.get(), previousSelectedValue)
        return selector(stream.get(), previousSelectedValue)
      })
    })
  }, [stream, selector])
  return state
}
