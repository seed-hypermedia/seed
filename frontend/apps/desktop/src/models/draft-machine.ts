import { HMDraft, HMEntityContent } from '@shm/shared'
import { setup, StateFrom } from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    context: {} as {
      error: any // TODO: fix types
    },
    events: {} as
      | {
          type: 'fetch.success'
          payload:
            | {type: 'load.new.draft'}
            | {type: 'draft'; data: HMDraft}
            | {type: 'location'; data: HMEntityContent}
            | {type: 'edit'; data: HMEntityContent}
        }
      | {
          type: 'fetch.error'
          error: any
        }
      | {
          type: 'change'
          metadata?: HMDraft['metadata']
          signingAccount?: string
        },
  },
  actions: {
    setErrorMessage: ({context, event}) => {
      if (event.type === 'fetch.error') {
        return {
          error: event.error,
        }
      }
    },
    populateEditor: ({context, event}) => {
      // Add your editor population logic here
      return context
    },
    focusName: ({context}) => {
      // Add your focus name logic here
      return context
    },
  },
  guards: {},
  delays: {},
}).createMachine({
  id: 'Draft',
  context: {
    error: '',
  },
  initial: 'fetching',
  states: {
    fetching: {
      on: {
        'load.new.draft': {
          target: 'editing',
        },
        'fetch.success': {
          target: 'setupData',
        },
        'fetch.error': {
          target: 'error',
          actions: ['setErrorMessage'],
        },
      },
    },
    setupData: {
      // always: {
      //   target: 'editing',
      //   actions: ['populateEditor'],
      // },
    },
    editing: {
      initial: 'idle',
      after: {
        100: {
          actions: ['focusName'],
        },
      },
      states: {
        idle: {
          on: {
            'change': {target: 'changed',
              actions: ['setAttributes', 'setSigningAccount'],
            }
            'reset.content': {target: 'changed',
              actions: ['resetContent'],
            }
          }
        },
        changed: {},
        saving: {},
      },
    },
    error: {},
  },
})
