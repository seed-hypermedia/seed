import {eventStream} from '@shm/shared/utils/stream'

export const [dispatchScroll, scrollEvents] = eventStream<any>()
