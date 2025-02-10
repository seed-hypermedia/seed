import {eventStream} from '@shm/shared/utils/stream'

export type DraftStatus = 'idle' | 'changed' | 'saving' | 'saved' | 'error'
export const [dispatchDraftStatus, draftStatus] = eventStream<DraftStatus>()
