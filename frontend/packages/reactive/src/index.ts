export {dispatch, onEvent, listSubscribedTopics, resetEventBus} from './event-bus'
export type {ReactiveEvent} from './event-bus'

export {acquireNode, resetRegistry, onTickFinished} from './graph'
export type {NodeDef, NodeState} from './graph'

export {useReactiveQuery, useReactiveTopic} from './react'

export const Topics = {
  LIBRARY: 'LIBRARY',
  directory: (account: string, path: string) => `DIRECTORY:${account}:${path}`,
  entity: (id: string) => `ENTITY:${id}`,
  account: (id: string) => `ACCOUNT:${id}`,
  comments: (entityId: string) => `COMMENTS:${entityId}`,
} as const
