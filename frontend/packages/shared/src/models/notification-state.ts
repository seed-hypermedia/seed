import type {NotificationPayload} from './notification-payload'
import {
  markAllNotificationsReadInState,
  markNotificationEventReadInState,
  markNotificationEventUnreadInState,
} from './notification-read-logic'

/** The persisted inbox window returned by the notify service. */
export type NotificationInboxPage = {
  notifications: NotificationPayload[]
  hasMore: boolean
  oldestEventAtMs: number | null
}

/** Canonical account-owned notification email settings. */
export type NotificationConfigState = {
  accountId: string
  email: string | null
  verifiedTime: string | null
  verificationSendTime: string | null
  verificationExpired: boolean
}

/** Canonical read markers for a notification account. */
export type NotificationReadState = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: Array<{eventId: string; eventAtMs: number}>
  updatedAt: string
}

/** Full notification state snapshot returned by the notify service. */
export type NotificationStateSnapshot = {
  accountId: string
  inbox: NotificationInboxPage
  config: NotificationConfigState
  readState: NotificationReadState
}

/** Mutation action applied by the shared notification reducer on clients and the notify service. */
export type NotificationMutationAction =
  | {
      type: 'mark-event-read'
      eventId: string
      eventAtMs: number
    }
  | {
      type: 'mark-event-unread'
      eventId: string
      eventAtMs: number
      otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
    }
  | {
      type: 'mark-all-read'
      markAllReadAtMs: number
    }
  | {
      type: 'set-config'
      email: string
      createdAtMs: number
    }
  | {
      type: 'resend-config-verification'
      createdAtMs: number
    }
  | {
      type: 'remove-config'
    }

/** Client-side queued notification action metadata. */
export type QueuedNotificationAction = NotificationMutationAction & {
  clientActionId: string
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function toIsoString(ms: number) {
  return new Date(ms).toISOString()
}

/** Creates an empty notification state for an account before the first server sync. */
export function createEmptyNotificationState(accountId: string): NotificationStateSnapshot {
  return {
    accountId,
    inbox: {
      notifications: [],
      hasMore: false,
      oldestEventAtMs: null,
    },
    config: {
      accountId,
      email: null,
      verifiedTime: null,
      verificationSendTime: null,
      verificationExpired: false,
    },
    readState: {
      accountId,
      markAllReadAtMs: null,
      readEvents: [],
      updatedAt: new Date(0).toISOString(),
    },
  }
}

/** Applies a single notification mutation to shared notification state. */
export function reduceNotificationState(
  state: NotificationStateSnapshot,
  action: NotificationMutationAction,
): NotificationStateSnapshot {
  if (action.type === 'mark-event-read') {
    const nextReadState = markNotificationEventReadInState({
      readState: state.readState,
      eventId: action.eventId,
      eventAtMs: action.eventAtMs,
    })
    return {
      ...state,
      readState: {
        ...state.readState,
        ...nextReadState,
      },
    }
  }

  if (action.type === 'mark-event-unread') {
    const nextReadState = markNotificationEventUnreadInState({
      readState: state.readState,
      eventId: action.eventId,
      eventAtMs: action.eventAtMs,
      otherLoadedEvents: action.otherLoadedEvents,
    })
    return {
      ...state,
      readState: {
        ...state.readState,
        ...nextReadState,
      },
    }
  }

  if (action.type === 'mark-all-read') {
    const nextReadState = markAllNotificationsReadInState({
      readState: state.readState,
      markAllReadAtMs: action.markAllReadAtMs,
    })
    return {
      ...state,
      readState: {
        ...state.readState,
        ...nextReadState,
      },
    }
  }

  if (action.type === 'set-config') {
    const email = normalizeEmail(action.email)
    if (!email) {
      return state
    }

    if (state.config.email === email && state.config.verifiedTime) {
      return state
    }

    if (
      state.config.email === email &&
      !state.config.verifiedTime &&
      state.config.verificationSendTime &&
      !state.config.verificationExpired
    ) {
      return state
    }

    return {
      ...state,
      config: {
        ...state.config,
        email,
        verifiedTime: null,
        verificationSendTime: toIsoString(action.createdAtMs),
        verificationExpired: false,
      },
    }
  }

  if (action.type === 'resend-config-verification') {
    if (!state.config.email || state.config.verifiedTime) {
      return state
    }
    if (state.config.verificationSendTime && !state.config.verificationExpired) {
      return state
    }
    return {
      ...state,
      config: {
        ...state.config,
        verificationSendTime: toIsoString(action.createdAtMs),
        verificationExpired: false,
      },
    }
  }

  return {
    ...state,
    config: {
      ...state.config,
      email: null,
      verifiedTime: null,
      verificationSendTime: null,
      verificationExpired: false,
    },
  }
}

/** Applies many queued notification actions in order. */
export function reduceNotificationStateActions(
  state: NotificationStateSnapshot,
  actions: NotificationMutationAction[],
): NotificationStateSnapshot {
  return actions.reduce((currentState, action) => reduceNotificationState(currentState, action), state)
}
