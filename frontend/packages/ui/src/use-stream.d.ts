import type {StateStream} from '@shm/shared'
export declare function useStream<StreamValue>(
  stream?: StateStream<StreamValue> | undefined,
): StreamValue | undefined
export declare function useStreamSelector<StreamValue, InternalValue>(
  stream: StateStream<StreamValue>,
  selector: (value: StreamValue) => InternalValue,
): InternalValue
