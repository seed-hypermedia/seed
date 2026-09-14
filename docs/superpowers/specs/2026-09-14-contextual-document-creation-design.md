# Contextual Document Creation Design

## Goal

Move document creation out of the document options menu and provide the same context-aware split-button workflow on
web and desktop. Creation should preserve the existing child-document flow for ordinary documents, create schema-aware
collection items at a collection's direct-child level, and establish a clean boundary for future declared document
schemas and a dedicated import actor.

## User Interface

The document top bar shows a split New control beside the existing document actions:

- The primary section is labeled `+ New` and immediately requests a normal document.
- A narrow chevron section opens the creation menu.
- The menu contains Document, Collection, and the platform's existing Import entry.
- The menu additionally contains Subdocument only while viewing a direct child of an editable collection.
- Import remains separated visually from document-type choices.

Document creation is removed entirely from the three-dot document options menu on web and desktop. File-browser
creation controls are outside this scope and retain their existing behavior.

The entire split control is visible but disabled while the actor is resolving the information required to create
safely. Once resolution completes, editors see an enabled control and non-editors do not see the control. Both sections
are disabled while a creation request is running. Existing button and dropdown primitives provide keyboard navigation,
focus, hover, pressed, disabled, and menu accessibility behavior.

## Contextual Destination Rules

| Loaded document | Parent collection access | Main New / Document | Collection / Import | Subdocument |
| --- | --- | --- | --- | --- |
| Collection | Current collection is editable | Child of the collection, with collection item schema | Child of the collection, with the applicable schema rules | Not shown |
| Direct child of a collection | Parent collection is editable | Sibling, with collection item schema | Sibling, with the applicable schema rules | Child of the loaded document, without collection schema |
| Direct child of a collection | Parent is not editable, but the loaded child is editable | Child of the loaded document, without collection schema | Child of the loaded document, without collection schema | Not shown because it would duplicate the default behavior |
| Any other editable document | Not applicable | Child of the loaded document, without collection schema | Child of the loaded document, without collection schema | Not shown |
| Non-editor | Not applicable | New control is removed after resolution | Not available | Not available |

Document, Collection, and Import always share the same default destination. Subdocument is the only menu action that
changes the destination away from the collection item level. This keeps the type choice separate from the placement
choice.

If optional immediate-parent classification fails, the actor conservatively uses the ordinary child-creation flow so
it cannot place a sibling at an unverified location. If current-document or current-permission resolution fails, the
control remains disabled and resolution can be retried.

## Document Creation Actor

A shared XState v5 actor owns creation readiness, destination policy, permission guards, schema resolution, and normal
document/collection creation. Web and desktop instantiate the same actor logic with platform-specific invoked actors
for reading resources and capabilities, reading local drafts, creating drafts, and navigating.

The actor starts client-side after the loaded document is available. Its principal states are:

```text
resolving
resolved.hidden
resolved.ready
creating
failed
importRequested (final)
created (final)
```

- `resolving` loads current edit capability, classifies the current document, loads and classifies its immediate
  parent when relevant, checks parent edit capability, and resolves the collection item schema when relevant. It has a
  loading tag used to disable the split button.
- `resolved.hidden` represents a resolved non-editor and renders no New control.
- `resolved.ready` accepts only the creation actions allowed by the resolved context. The UI uses actor state and
  `snapshot.can(...)` rather than reconstructing permission booleans.
- `creating` invokes the injected platform operation with an immutable request containing the action kind,
  destination, capability, initial metadata, and collection seed when applicable. Duplicate requests are invalid in
  this state.
- `failed` exposes an actionable creation error and allows retry or a return to ready.
- `created` is a successful final state. Existing platform navigation normally replaces the page.
- `importRequested` is a terminal handoff described below.

The public events are:

```ts
type DocumentCreationEvent =
  | {type: 'create.requested'; kind: 'document' | 'collection' | 'subdocument'}
  | {type: 'import.requested'}
  | {type: 'retry.requested'}
```

Navigating to another document creates a fresh actor with new input so resolved hierarchy, schema, and permissions are
never reused across documents. Unmounting stops actor-owned requests, using abort signals where supported. The actor
uses no polling, sleeps, or retry timers.

## Schema Resolution Boundary

The actor invokes a focused schema resolver. Its contract is designed so inferred schemas can later be replaced with
declared document schemas without changing actor events, destinations, platform creation adapters, or UI code.

```ts
type DocumentSchemaAttribute =
  | {key: string; type: 'text'}
  | {key: string; type: 'number'}
  | {key: string; type: 'toggle'}
  | {key: string; type: 'object'; attributes: DocumentSchemaAttribute[]}

type DocumentSchema = {
  attributes: DocumentSchemaAttribute[]
}

type ResolveDocumentSchemaInput = {
  collectionId: UnpackedHypermediaId
  publishedChildren: HMDocumentInfo[]
  draftChildren: Array<{id: UnpackedHypermediaId; metadata: HMMetadata}>
}
```

For now, the resolver infers a collection item schema as follows:

1. Inspect only direct children of the collection: the same account and a path exactly one segment deeper than the
   collection path.
2. Include published direct children and locally available unpublished direct-child drafts.
3. Collect the union of custom metadata paths and infer text, number, toggle, and object types from their values.
4. Exclude only keys in the canonical `BUILTIN_METADATA_KEYS` set. `type` is a custom attribute and is not excluded.
5. Ignore deleted or absent values such as `null` when gathering type evidence.
6. When the same attribute path has multiple observed types, select the most frequently observed type. Resolve ties
   with the fixed order `text`, `number`, `toggle`, then `object` so results do not depend on query ordering.
7. Merge object shapes recursively, applying the same union and type-conflict rules at every nested path.
8. Return attributes and nested object fields ordered lexicographically by key.

Schema inference is activated only for creation at a collection's direct-child level. Ordinary subdocument creation
does not infer or apply schemas. If schema inference fails, creation remains available at the correctly resolved
destination without inferred attributes; the failure is recorded through existing diagnostics.

When declared schemas land, the resolver can read the collection's declared item schema and optionally retain the
inference path as a fallback. The returned `DocumentSchema` contract remains stable.

## Initial Attribute Values

New Documents and Collections created at the collection item level receive all resolved schema attributes. Primitive
values use the metadata editor's existing starter semantics:

| Schema type | Initial value |
| --- | --- |
| Text | `''` |
| Number | `0` |
| Toggle | `true` |

Object attributes copy the inferred recursive shape but never copy existing leaf values. For example:

```ts
// Existing collection item
{
  customer: {
    name: 'Alice',
    score: 42,
    active: false,
    address: {city: 'Berlin'},
  },
}

// New collection item
{
  customer: {
    name: '',
    score: 0,
    active: true,
    address: {city: ''},
  },
}
```

For imports at the collection item level, imported metadata is preserved. The import workflow adds only schema paths
that are absent from the imported metadata, using the same type-aware starter values and recursive object shape. A
present `null`, `false`, `0`, empty object, or empty string is not considered missing and is never overwritten.

The special `type` exclusion in `frontend/packages/ui/src/query-block-table-model.ts` is removed so collection table
attribute discovery also treats `type` like every other custom metadata field.

## Import Handoff

Import is not implemented as an invoked operation inside the creation actor. On `import.requested`, the actor captures
the resolved destination, signing capability, and inferred schema, then finishes in `importRequested` with typed output:

```ts
type DocumentCreationOutput =
  | {
      type: 'import'
      destination: UnpackedHypermediaId
      capabilityCid?: string
      schema?: DocumentSchema
    }
  | {
      type: 'created'
      documentId: UnpackedHypermediaId
    }
```

The platform host consumes the output and starts its existing import workflow. Desktop retains its existing import
choices; web retains Import Markdown File. Import dialogs, file reading, transformation, progress, cancellation, and
errors remain owned by those workflows.

The host creates a fresh document creation actor after the import workflow closes or is cancelled so New becomes
usable again. While the workflow is open, the finalized creation actor leaves the control disabled.

This terminal output becomes the input contract for a future reusable import actor. That actor can later be spawned by
the creation actor or by any other caller without moving hierarchy or schema policy into the import implementation.

## Web Performance

The existing server-rendered and critical document-loading paths are unchanged. Parent lookup, parent capability,
direct-child discovery, local-draft discovery, and schema resolution begin client-side only after the current document
has loaded. The top bar renders immediately with a disabled New split button while the actor resolves this information.
These checks must not be added to SSR loaders or awaited by the initial document query.

## Error Handling

- Permission denial is a normal resolved outcome and hides the control; it is not shown as an error.
- A failed optional parent lookup falls back to ordinary child creation.
- A failed required current-document or permission lookup leaves the control disabled and exposes a retry path.
- A failed schema inference records diagnostics but does not prevent correctly placed creation.
- A failed document or collection creation uses the platform's existing toast presentation and allows retry.
- Import progress, cancellation, and errors remain outside this actor.

## Verification

Shared actor and resolver tests cover:

- Collection-to-child, collection-child-to-sibling, and explicit Subdocument placement.
- Parent-collection permission denial falling back to ordinary child placement.
- Unchanged ordinary-document child creation.
- Resolving, ready, hidden, creating, failed, import terminal, and created terminal states.
- Valid events and duplicate-request rejection through actor transitions.
- Optional parent lookup and schema inference failures.
- Published and local-draft schema sources.
- Direct-child filtering and deeper-descendant exclusion.
- Custom `type` retention and collection-table discovery.
- Text, number, toggle, recursively shaped object initialization, and empty leaf values.
- Mixed-type frequency selection with deterministic ties.
- Imported value preservation and recursive addition of missing schema paths.
- Typed terminal import output.

Web and desktop integration tests cover equivalent actor inputs, platform draft creation, navigation, and import
handoff. Shared UI tests cover the split-button states, menu contents, absence of New from the three-dot menu, primary
action behavior, keyboard accessibility, and disabled behavior during resolution. Web verification also asserts that
the deferred actor resolution does not become part of SSR or the initial document-loading path.

## Out of Scope

- Declared document schemas and schema authoring UI.
- The future reusable import actor.
- New import formats or changes to existing platform import dialogs.
- Changes to file-browser document creation.
- Schema inheritance for ordinary documents or explicit Subdocument creation.
