import {assign, createActor, setup} from 'xstate'
import isEqual from 'lodash/isEqual'
import type {NavRoute} from '@shm/shared/routes'
import {navStateReducer, type NavAction, type NavState} from '@shm/shared/utils/navigation'
import {reconcileBrowserNavigation, type BrowserLocation} from './browser-navigation'
import {getRouteWindowResourceKeys, type WindowDraftLookup} from './utils/route-window-identity'

/** All desktop operations that can change the active route or its history. */
export type WindowNavigationAction =
  | NavAction
  | {type: 'browserLocation'; location: BrowserLocation; requested: boolean}
  | {type: 'resolveBrowser'; url: string; route: NavRoute}

/** Authorized history sent to a renderer; replaying a command cannot append another entry. */
export type WindowNavigationCommit = {requestId: number; state: NavState}

type Request = {windowId: string; action: WindowNavigationAction; focus: boolean}
type WindowRecord = {state: NavState; ready: boolean; keys: string[]}
type Pending = {windowId: string; state: NavState; requestId: number; apply: boolean; focus: boolean; keys: string[]}
type Effects = {
  getDraft: WindowDraftLookup
  apply: (windowId: string, requestId: number, state: NavState) => void
  focus: (windowId: string) => void
  commit: (windowId: string, state: NavState) => void
  close: (windowId: string) => void
  error: (windowId: string, error: unknown) => void
}
type Context = {
  windows: Record<string, WindowRecord>
  queue: Request[]
  current?: Request
  pending?: Pending
  nextId: number
  effects: Effects
}
type Event =
  | {type: 'REGISTER'; windowId: string; state: NavState; keys: string[]}
  | {type: 'READY'; windowId: string}
  | {type: 'DISCONNECTED'; windowId: string}
  | {type: 'CLOSED'; windowId: string}
  | {type: 'REQUEST'; request: Request}
  | {type: 'ACK'; windowId: string; requestId: number}
  | {type: 'DELIVERY_FAILED'}

function keys(context: Context, state: NavState) {
  const route = state.routes[state.routeIndex]
  return route ? getRouteWindowResourceKeys(route, context.effects.getDraft) : []
}

function owner(context: Context, route: NavRoute): string | undefined {
  const requested = getRouteWindowResourceKeys(route, context.effects.getDraft)
  if (!requested.length) return undefined
  // A transition reserves its destination in addition to its still-visible old route.
  if (context.pending && context.pending.keys.some((key) => requested.includes(key))) {
    return context.pending.windowId
  }
  return Object.entries(context.windows).find(([, window]) => window.keys.some((key) => requested.includes(key)))?.[0]
}

function nextState(state: NavState, action: WindowNavigationAction) {
  if (action.type === 'browserLocation') return reconcileBrowserNavigation(state, action.location, action.requested)
  if (action.type === 'resolveBrowser') {
    const current = state.routes[state.routeIndex]
    if (current?.key !== 'web' || current.url !== action.url) return state
    const routes = [...state.routes]
    routes[state.routeIndex] = action.route
    return {...state, routes}
  }
  return navStateReducer(state, action)
}

/** Main-process authority: reservations last until a renderer commit or confirmed window closure. */
export const windowNavigationMachine = setup({
  types: {context: {} as Context, events: {} as Event, input: {} as Effects},
  guards: {
    hasQueued: ({context}) => context.queue.length > 0,
    noPending: ({context}) => !context.pending,
    targetReady: ({context}) => !!context.pending && !!context.windows[context.pending.windowId]?.ready,
    focusOnly: ({context}) => !context.pending?.apply,
    matchingAck: ({context, event}) =>
      event.type === 'ACK' &&
      context.pending?.windowId === event.windowId &&
      context.pending.requestId === event.requestId,
    targetClosed: ({context, event}) => event.type === 'CLOSED' && context.pending?.windowId === event.windowId,
    targetDisconnected: ({context, event}) =>
      event.type === 'DISCONNECTED' && context.pending?.windowId === event.windowId,
  },
  actions: {
    register: assign(({context, event}) =>
      event.type === 'REGISTER'
        ? {
            windows: {...context.windows, [event.windowId]: {state: event.state, ready: false, keys: event.keys}},
          }
        : {},
    ),
    ready: assign(({context, event}) =>
      event.type === 'READY' && context.windows[event.windowId]
        ? {
            windows: {...context.windows, [event.windowId]: {...context.windows[event.windowId]!, ready: true}},
          }
        : {},
    ),
    disconnected: assign(({context, event}) =>
      event.type === 'DISCONNECTED' && context.windows[event.windowId]
        ? {
            windows: {...context.windows, [event.windowId]: {...context.windows[event.windowId]!, ready: false}},
          }
        : {},
    ),
    closed: assign(({context, event}) => {
      if (event.type !== 'CLOSED') return {}
      const windows = {...context.windows}
      delete windows[event.windowId]
      const queue = context.queue.filter((request) => request.windowId !== event.windowId)
      if (context.pending?.windowId === event.windowId && context.current && windows[context.current.windowId])
        queue.unshift(context.current)
      return {windows, queue}
    }),
    enqueue: assign(({context, event}) => (event.type === 'REQUEST' ? {queue: [...context.queue, event.request]} : {})),
    resolve: assign(({context}) => {
      const [current, ...queue] = context.queue
      if (!current || !context.windows[current.windowId]) return {queue, current, pending: undefined}
      try {
        const source = context.windows[current.windowId]!.state
        const next = nextState(source, current.action)
        if (next === source) {
          if (current.action.type === 'closeBack') context.effects.close(current.windowId)
          return {queue, current, pending: undefined}
        }
        const route = next.routes[next.routeIndex]!
        const targetId = owner(context, route) ?? current.windowId
        const target = context.windows[targetId]!.state
        const crossWindow = targetId !== current.windowId
        const exactReopen =
          (crossWindow || current.action.type === 'push') && isEqual(target.routes[target.routeIndex], route)
        const pending = {
          windowId: targetId,
          state: exactReopen ? target : crossWindow ? navStateReducer(target, {type: 'push', route}) : next,
          requestId: context.nextId,
          keys: getRouteWindowResourceKeys(route, context.effects.getDraft),
          apply: !exactReopen,
          focus: current.focus || crossWindow,
        }
        return {queue, current, pending, nextId: context.nextId + 1}
      } catch (error) {
        context.effects.error(current.windowId, error)
        return {queue, current, pending: undefined}
      }
    }),
    deliver: ({context, self}) => {
      const pending = context.pending!
      try {
        context.effects.apply(pending.windowId, pending.requestId, pending.state)
      } catch (error) {
        context.effects.error(pending.windowId, error)
        self.send({type: 'DELIVERY_FAILED'})
      }
    },
    commit: assign(({context}) => {
      const pending = context.pending!
      context.effects.commit(pending.windowId, pending.state)
      return {
        windows: {
          ...context.windows,
          [pending.windowId]: {...context.windows[pending.windowId]!, state: pending.state, keys: pending.keys},
        },
      }
    }),
    focus: ({context}) => {
      if (context.pending?.focus) context.effects.focus(context.pending.windowId)
    },
    clear: assign({pending: undefined, current: undefined}),
  },
}).createMachine({
  id: 'windowNavigation',
  initial: 'idle',
  context: ({input}) => ({windows: {}, queue: [], nextId: 1, effects: input}),
  on: {
    REGISTER: {actions: 'register'},
    READY: {actions: 'ready'},
    REQUEST: {actions: 'enqueue'},
    DISCONNECTED: [
      {guard: 'targetDisconnected', actions: 'disconnected', target: '.reconciling'},
      {actions: 'disconnected'},
    ],
    CLOSED: [{guard: 'targetClosed', actions: ['closed', 'clear'], target: '.idle'}, {actions: 'closed'}],
  },
  states: {
    idle: {always: {guard: 'hasQueued', target: 'resolving'}},
    resolving: {entry: 'resolve', always: [{guard: 'noPending', target: 'idle'}, {target: 'awaitingReady'}]},
    awaitingReady: {always: {guard: 'targetReady', target: 'dispatching'}},
    dispatching: {
      always: [{guard: 'focusOnly', actions: ['focus', 'clear'], target: 'idle'}, {target: 'awaitingCommit'}],
    },
    awaitingCommit: {
      entry: 'deliver',
      on: {ACK: {guard: 'matchingAck', target: 'committing'}, DELIVERY_FAILED: {target: 'reconciling'}},
    },
    committing: {entry: ['commit', 'focus', 'clear'], always: 'idle'},
    reconciling: {
      on: {
        READY: {actions: 'ready', target: 'awaitingReady'},
        ACK: {guard: 'matchingAck', target: 'committing'},
      },
    },
  },
})

/** Creates one live coordinator per app; Electron and tests supply its effects. */
export function createWindowNavigation(effects: Effects) {
  const actor = createActor(windowNavigationMachine, {input: effects}).start()
  return {
    actor,
    register(windowId: string, state: NavState) {
      const route = state.routes[state.routeIndex]
      if (route && owner(actor.getSnapshot().context, route)) throw new Error('Resource already has a window owner')
      actor.send({type: 'REGISTER', windowId, state, keys: keys(actor.getSnapshot().context, state)})
    },
    request: (windowId: string, action: WindowNavigationAction, focus = true) =>
      actor.send({type: 'REQUEST', request: {windowId, action, focus}}),
    ready: (windowId: string) => actor.send({type: 'READY', windowId}),
    disconnected: (windowId: string) => actor.send({type: 'DISCONNECTED', windowId}),
    closed: (windowId: string) => actor.send({type: 'CLOSED', windowId}),
    acknowledge: (windowId: string, requestId: number) => actor.send({type: 'ACK', windowId, requestId}),
    owner: (route: NavRoute) => owner(actor.getSnapshot().context, route),
    state: (windowId: string) => actor.getSnapshot().context.windows[windowId]?.state,
  }
}
