import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {assign, fromPromise, setup} from 'xstate'
import {createSchemaMetadata, type DocumentSchema} from './document-creation-schema'

/** Facts loaded by a platform adapter to classify one creation location. */
export type DocumentCreationResolutionInput = {
  canEditCurrent: boolean
  currentIsCollection: boolean
  parentId?: UnpackedHypermediaId
  parentIsCollection?: boolean
  canEditParent?: boolean
  capabilityCid?: string
  schema?: DocumentSchema
}

/** An immutable platform creation request resolved by the actor. */
export type DocumentCreationRequest = {
  kind: 'document' | 'collection' | 'subdocument'
  destination: UnpackedHypermediaId
  metadata: HMMetadata
}

/** Platform effects supplied when starting the document creation actor. */
export type DocumentCreationInput = {
  currentId: UnpackedHypermediaId
  resolve: (signal: AbortSignal) => Promise<DocumentCreationResolutionInput>
  create: (request: DocumentCreationRequest, signal: AbortSignal) => Promise<UnpackedHypermediaId>
}

/** Events accepted by the document creation actor. */
export type DocumentCreationEvent =
  | {type: 'create.requested'; kind: DocumentCreationRequest['kind']}
  | {type: 'import.requested'}
  | {type: 'retry.requested'}

/** Terminal result returned to the platform host. */
export type DocumentCreationOutput =
  | {type: 'created'; documentId: UnpackedHypermediaId}
  | {
      type: 'import'
      destination: UnpackedHypermediaId
      capabilityCid?: string
      schema?: DocumentSchema
    }

type Context = {
  input: DocumentCreationInput
  resolution: DocumentCreationResolutionInput | null
  request: DocumentCreationRequest | null
  createdId: UnpackedHypermediaId | null
  output: DocumentCreationOutput | null
  error: unknown
}

function defaultDestination(context: Context): UnpackedHypermediaId {
  const resolution = context.resolution!
  if (resolution.parentIsCollection && resolution.canEditParent && resolution.parentId) return resolution.parentId
  return context.input.currentId
}

function schemaApplies(context: Context): boolean {
  const resolution = context.resolution!
  return resolution.currentIsCollection || !!(resolution.parentIsCollection && resolution.canEditParent)
}

/** Shared XState actor for resolving and executing contextual document creation. */
export const documentCreationMachine = setup({
  types: {
    context: {} as Context,
    input: {} as DocumentCreationInput,
    events: {} as DocumentCreationEvent,
    output: {} as DocumentCreationOutput,
  },
  actors: {
    resolveCreation: fromPromise<DocumentCreationResolutionInput, DocumentCreationInput>(({input, signal}) =>
      input.resolve(signal),
    ),
    createDocument: fromPromise<UnpackedHypermediaId, {input: DocumentCreationInput; request: DocumentCreationRequest}>(
      ({input, signal}) => input.input.create(input.request, signal),
    ),
  },
  guards: {
    canEdit: ({context}) => !!context.resolution?.canEditCurrent,
    canCreateRequestedKind: ({context, event}) => {
      if (event.type !== 'create.requested') return false
      return (
        event.kind !== 'subdocument' ||
        !!(
          !context.resolution?.currentIsCollection &&
          context.resolution?.parentIsCollection &&
          context.resolution.canEditParent
        )
      )
    },
  },
  actions: {
    storeRequest: assign({
      request: ({context, event}) => {
        if (event.type !== 'create.requested') return null
        const useSchema = event.kind !== 'subdocument' && schemaApplies(context)
        return {
          kind: event.kind,
          destination: event.kind === 'subdocument' ? context.input.currentId : defaultDestination(context),
          metadata: useSchema && context.resolution?.schema ? createSchemaMetadata(context.resolution.schema) : {},
        }
      },
      error: () => null,
    }),
    storeImportOutput: assign({
      output: ({context}): DocumentCreationOutput => ({
        type: 'import',
        destination: defaultDestination(context),
        capabilityCid: context.resolution?.capabilityCid,
        schema: schemaApplies(context) ? context.resolution?.schema : undefined,
      }),
    }),
  },
}).createMachine({
  id: 'documentCreation',
  context: ({input}) => ({input, resolution: null, request: null, createdId: null, output: null, error: null}),
  initial: 'resolving',
  states: {
    resolving: {
      tags: ['loading'],
      invoke: {
        src: 'resolveCreation',
        input: ({context}) => context.input,
        onDone: [
          {
            guard: ({event}) => event.output.canEditCurrent,
            actions: assign({resolution: ({event}) => event.output, error: () => null}),
            target: 'resolved.ready',
          },
          {actions: assign({resolution: ({event}) => event.output, error: () => null}), target: 'resolved.hidden'},
        ],
        onError: {actions: assign({error: ({event}) => event.error}), target: 'failedResolution'},
      },
    },
    resolved: {
      initial: 'ready',
      states: {
        ready: {
          on: {
            'create.requested': {
              guard: 'canCreateRequestedKind',
              actions: 'storeRequest',
              target: '#documentCreation.creating',
            },
            'import.requested': {actions: 'storeImportOutput', target: '#documentCreation.importRequested'},
          },
        },
        hidden: {},
      },
    },
    creating: {
      tags: ['busy'],
      invoke: {
        src: 'createDocument',
        input: ({context}) => ({input: context.input, request: context.request!}),
        onDone: {
          actions: assign({
            createdId: ({event}) => event.output,
            output: ({event}) => ({type: 'created', documentId: event.output}),
          }),
          target: 'created',
        },
        onError: {actions: assign({error: ({event}) => event.error}), target: 'failedCreation'},
      },
    },
    failedResolution: {
      tags: ['error'],
      on: {'retry.requested': {target: 'resolving'}},
    },
    failedCreation: {
      tags: ['error'],
      on: {'retry.requested': {target: 'resolved.ready'}},
    },
    importRequested: {type: 'final'},
    created: {type: 'final'},
  },
  output: ({context}) => context.output!,
})
