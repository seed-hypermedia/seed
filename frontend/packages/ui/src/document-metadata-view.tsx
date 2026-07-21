import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {Braces, Check, FileCode2, X} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {seedValue} from './onyx/onyx-data-editor'
import {OnyxSchemaProvider} from './onyx/onyx-schema-context'
import {SchemaErrorSummary} from './onyx/onyx-value-editor-schema'
import {RESERVED_METADATA_KEYS, SCHEMA_DEFINITION_KEY, schemaDefinitionCid} from './onyx/schema-document'
import {SchemaEditorDialog} from './onyx/onyx-schema-editor'
import {
  buildSchemaKeyRoot,
  collectSchemaKeyCids,
  documentMetadataSchema,
  schemaKeyCid,
} from './onyx/onyx-metadata-schema-keys'
import {useOnyxSchemaRegistry} from './onyx/onyx-schema-registry-cid'
import type {OnyxSchema} from './onyx/onyx-engine'
import {Button} from './button'
import {Input} from './components/input'
import {Textarea} from './components/textarea'
import {parseCidString} from './dag-json'
import {Tooltip} from './tooltip'
import {cn} from './utils'
import {
  AddFieldForm,
  canonicalEntries,
  FIELD_LABEL_CLASS,
  FieldRow,
  findInvalidValue,
  isPlainObject,
  METADATA_VALUE_RULES,
  toCanonicalOrder,
  useValueHistory,
  ValueDisplay,
  ValueEditorProvider,
} from './value-editor'

/**
 * A staged partial update: top-level keys map to their new value, or `null`
 * to remove the field (publishes a nullValue attribute op).
 */
export type MetadataPatch = Record<string, unknown>

/** Deep-remove null values. In metadata a null is a tombstone (deleted/absent),
 * so for schema validation we strip them: an absent required field then reads as
 * "required" (not "expected string, got null"), and absent optional fields don't
 * error at all. */
function stripNullsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullsDeep)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (v === null) continue
      out[key] = stripNullsDeep(v)
    }
    return out
  }
  return value
}

/**
 * Publish ops are generated from the draft metadata without a base document,
 * so a nested key that simply disappears emits no op and its old value would
 * survive. Removed nested object keys therefore become explicit `null`
 * tombstones, which publish as nullValue ops and clear the attribute.
 */
function withNestedTombstones(prev: unknown, next: unknown): unknown {
  if (!isPlainObject(prev) || !isPlainObject(next)) return next
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    result[key] = withNestedTombstones(prev[key], value)
  }
  // Keys absent from `next` become (or remain) null tombstones.
  for (const [key, value] of Object.entries(prev)) {
    if (value !== undefined && !(key in next)) result[key] = null
  }
  return result
}

/**
 * Compute the staged patch that turns `prev` into `next` (removed keys → null
 * tombstones). `prev` must be the raw draft metadata including existing null
 * tombstones so they survive unrelated edits.
 */
export function diffMetadata(prev: Record<string, unknown>, next: Record<string, unknown>): MetadataPatch {
  const patch: MetadataPatch = {}
  for (const [key, value] of Object.entries(next)) {
    const merged = withNestedTombstones(prev[key], value)
    if (JSON.stringify(prev[key]) !== JSON.stringify(merged)) patch[key] = merged
  }
  for (const [key, value] of Object.entries(prev)) {
    if (value !== undefined && !(key in next)) patch[key] = null
  }
  return patch
}

/**
 * Metadata view for the `:metadata` document route. Read-only without edit
 * permission; with `canEdit` + `onMetadata` it becomes a recursive editor
 * where every change is staged as a draft patch and published via the
 * standard publish flow. A raw JSON mode allows full editing in one place.
 */
export function DocumentMetadataView({
  metadata,
  canEdit = false,
  onMetadata,
  conformanceSchema,
  fileUpload,
  openFile,
  onCreateBlob,
}: {
  metadata?: HMMetadata | null
  canEdit?: boolean
  onMetadata?: (patch: MetadataPatch) => void
  /**
   * The resolved metadata schema this document must CONFORM to (from its own
   * `schema` field, or a parent's `childrenSchema`) — drives required fields and
   * advisory validation. Resolved by the caller (see useEffectiveDocSchema);
   * distinct from `schemaDefinition`, which is a schema this document DEFINES.
   */
  conformanceSchema?: OnyxSchema
  /** Uploads a file dropped onto a string field to IPFS, returning its CID. */
  fileUpload?: (file: File) => Promise<string>
  /** Opens an uploaded IPFS file (by CID) in its own dedicated viewer window. */
  openFile?: (cid: string) => void
  /** Opens a blank blob editor (new IPFS object) in its own window. */
  onCreateBlob?: () => void
}) {
  const [jsonMode, setJsonMode] = useState(false)
  const [attachMode, setAttachMode] = useState(false)
  // The schema editor dialog: open with an `editingSchema` to edit the document's
  // existing type, or without one to define a new type (opened when the user adds
  // a `schemaDefinition` field, or from the existing schemaDefinition row).
  const [schemaEditorOpen, setSchemaEditorOpen] = useState(false)
  const [editingSchema, setEditingSchema] = useState<OnyxSchema | undefined>(undefined)
  const current = useMemo(() => (metadata ?? {}) as Record<string, unknown>, [metadata])
  // Null tombstones = absent, so validate against a null-stripped copy.
  const validationValue = useMemo(() => stripNullsDeep(current), [current])
  const entries = canonicalEntries(current, {hideNull: true})
  const editable = canEdit && !!onMetadata

  // Schema-keyed fields: a key in the `ipfs://<schemaCid>` form means the
  // value is expected to conform to that schema. Fetch those schemas and
  // synthesize a root schema so the rows get advisory hints and warnings.
  // A schema being typed into the attach bar prefetches too, so attaching
  // can seed the field from the schema immediately.
  const [pendingSchemaCid, setPendingSchemaCid] = useState<string | null>(null)
  const visibleKeys = entries.map(([key]) => key)
  const keysDep = visibleKeys.join('\n')
  // The schema this document describes (the `schemaDefinition` field's CID), if any.
  const schemaDefCid = schemaDefinitionCid(current)
  const seedCids = useMemo(() => {
    const cids = collectSchemaKeyCids(visibleKeys)
    if (pendingSchemaCid && !cids.includes(pendingSchemaCid)) cids.push(pendingSchemaCid)
    if (schemaDefCid && !cids.includes(schemaDefCid)) cids.push(schemaDefCid)
    return cids
  }, [keysDep, pendingSchemaCid, schemaDefCid])
  const {byCid} = useOnyxSchemaRegistry(seedCids)
  const schemaDefSchema = schemaDefCid ? byCid[schemaDefCid] : undefined
  // The metadata schema that drives field suggestions + advisory validation is
  // the document's CONFORMANCE schema (its `schema`, or a parent's
  // `childrenSchema`), resolved by the caller and passed as `conformanceSchema`.
  // Its metadata EXTENDS the base document-metadata schema (`hypermedia-metadata`):
  // standard fields (name/summary/…) are inherited and the type's own fields
  // added — required ones surface as always-visible rows. Kept OPEN (`values:{}`)
  // so the binding fields and any arbitrary key are still allowed. Without a
  // conformance schema, only schema-keyed (ipfs://) fields drive hints (the prior
  // behavior). The pending key keeps the add-field form schema-driven the moment
  // a schema URL is typed as a name.
  const schemaRoot = useMemo(() => {
    const keys = pendingSchemaCid ? [...visibleKeys, `ipfs://${pendingSchemaCid}`] : visibleKeys
    const keyRoot = buildSchemaKeyRoot(keys, byCid)
    // Always fold in the base document-metadata schema so standard fields keep
    // their semantic types (e.g. `schema`/`childrenSchema` render as HM-link
    // pills, `icon`/`cover` as IPFS files) even without a conformance schema; the
    // conformance schema (if any) adds/refines on top.
    return documentMetadataSchema(conformanceSchema ?? {}, keyRoot?.properties as Record<string, OnyxSchema>, byCid)
  }, [keysDep, pendingSchemaCid, byCid, conformanceSchema])

  // Custom required fields declared by the conformance schema are ALWAYS shown
  // (seeded if absent), so the user never has to "add" a mandatory field. Header
  // fields (name/summary) and the schema-binding fields live elsewhere / are
  // authored specially, so they're excluded from the required rows.
  const requiredKeys = useMemo(
    () =>
      (Array.isArray(schemaRoot?.required) ? (schemaRoot!.required as string[]) : []).filter(
        (k) => !RESERVED_METADATA_KEYS.has(k),
      ),
    [schemaRoot],
  )
  const requiredRows = useMemo(
    () =>
      requiredKeys.map((key) => ({
        key,
        value:
          key in current && current[key] != null
            ? current[key]
            : seedValue((schemaRoot?.properties?.[key] as OnyxSchema) ?? {}),
      })),
    [requiredKeys, current, schemaRoot],
  )
  const requiredSet = useMemo(() => new Set(requiredKeys), [requiredKeys])
  const otherEntries = useMemo(() => entries.filter(([k]) => !requiredSet.has(k)), [entries, requiredSet])

  // Undo/redo over snapshots of the merged metadata: `record()` before each
  // staged patch; undo/redo apply the diff back to the snapshot.
  const history = useValueHistory(current)
  const stage = (patch: MetadataPatch) => {
    history.record()
    onMetadata!(patch)
  }
  const handleUndo = () => {
    const snapshot = history.undo()
    if (snapshot) onMetadata!(diffMetadata(current, snapshot.value))
  }
  const handleRedo = () => {
    const snapshot = history.redo()
    if (snapshot) onMetadata!(diffMetadata(current, snapshot.value))
  }

  return (
    <ValueEditorProvider
      onUndo={editable ? handleUndo : undefined}
      onRedo={editable ? handleRedo : undefined}
      fileUpload={editable ? fileUpload : undefined}
      openFile={openFile}
      onCreateBlob={editable ? onCreateBlob : undefined}
    >
      <OnyxSchemaProvider schema={schemaRoot} registry={{}} value={validationValue}>
        <div className="flex flex-col gap-4 py-6">
          {/* No title here — the tab/breadcrumb (main view) and the panel header
              already label this "Attributes". */}
          {editable && <SchemaErrorSummary />}
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1">
              {editable && !jsonMode && (
                <Tooltip content="Attach a schema as a metadata field (the field key is the schema's ipfs:// URL)">
                  <Button
                    variant={attachMode ? 'secondary' : 'ghost'}
                    size="icon"
                    aria-label="Attach schema field"
                    onClick={() => setAttachMode((mode) => !mode)}
                  >
                    <FileCode2 className="size-4" />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content={jsonMode ? 'Edit as fields' : 'Edit as JSON'}>
                <Button
                  variant={jsonMode ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label={jsonMode ? 'Edit as fields' : 'Edit as JSON'}
                  onClick={() => setJsonMode((mode) => !mode)}
                >
                  <Braces className="size-4" />
                </Button>
              </Tooltip>
            </div>
          </div>
          {editable && attachMode && !jsonMode && (
            <AttachSchemaFieldBar
              existingKeys={visibleKeys}
              registry={byCid}
              onPendingCid={setPendingSchemaCid}
              onCancel={() => {
                setPendingSchemaCid(null)
                setAttachMode(false)
              }}
              onAttach={(key, value) => {
                stage({[key]: value})
                setPendingSchemaCid(null)
                setAttachMode(false)
              }}
            />
          )}
          {editable && schemaEditorOpen && (
            <SchemaEditorDialog
              open={schemaEditorOpen}
              onOpenChange={(open) => {
                setSchemaEditorOpen(open)
                if (!open) setEditingSchema(undefined)
              }}
              initialSchema={editingSchema}
              onSaved={(cid) => stage({[SCHEMA_DEFINITION_KEY]: `ipfs://${cid}`})}
            />
          )}
          {jsonMode ? (
            <MetadataJsonEditor metadata={current} editable={editable} onMetadata={editable ? stage : undefined} />
          ) : editable ? (
            <>
              {requiredRows.length === 0 && otherEntries.length === 0 ? (
                <p className="text-muted-foreground text-sm">This document has no metadata.</p>
              ) : (
                <div className="flex flex-col">
                  {/* Required fields declared by the schema come first and are
                      ALWAYS shown (seeded if the value is absent), so a mandatory
                      field never has to be "added" by hand. */}
                  {requiredRows.map(({key, value}) => (
                    <FieldRow
                      key={key}
                      className="border-border border-b py-3 last:border-b-0"
                      fieldKey={key}
                      value={value}
                      // Schema-required fields are always present and cannot be
                      // removed; their name is fixed by the schema.
                      canRemove={false}
                      siblingKeys={entries.map(([k]) => k).filter((k) => k !== key)}
                      onValue={(newValue) => stage({[key]: newValue})}
                      onEditField={(_newKey, newValue) => stage({[key]: newValue})}
                      onRemove={() => {}}
                      rules={METADATA_VALUE_RULES}
                      path={[key]}
                    />
                  ))}
                  {otherEntries.map(([key, value]) =>
                    // The reserved schemaDefinition field describes the document's
                    // type — edit it with the schema editor, never as a raw string.
                    key === SCHEMA_DEFINITION_KEY ? (
                      <SchemaDefinitionRow
                        key={key}
                        typeName={typeof schemaDefSchema?.name === 'string' ? schemaDefSchema.name : undefined}
                        state={schemaDefCid ? (schemaDefSchema ? 'edit' : 'loading') : 'define'}
                        onOpen={() => {
                          // Empty/invalid schemaDefinition → define a fresh type;
                          // a resolved one → edit it.
                          setEditingSchema(schemaDefCid ? schemaDefSchema : undefined)
                          setSchemaEditorOpen(true)
                        }}
                        onRemove={() => stage({[key]: null})}
                      />
                    ) : (
                      <FieldRow
                        key={key}
                        className="border-border border-b py-3 last:border-b-0"
                        fieldKey={key}
                        value={value}
                        siblingKeys={entries.map(([k]) => k).filter((k) => k !== key)}
                        onValue={(newValue) => stage({[key]: newValue})}
                        onEditField={(newKey, newValue) =>
                          stage(newKey === key ? {[key]: newValue} : {[key]: null, [newKey]: newValue})
                        }
                        onRemove={() => stage({[key]: null})}
                        rules={METADATA_VALUE_RULES}
                        path={[key]}
                      />
                    ),
                  )}
                </div>
              )}
              <AddFieldForm
                rules={METADATA_VALUE_RULES}
                path={[]}
                existingKeys={[...entries.map(([key]) => key), ...requiredKeys]}
                onKeyTextChange={(keyText) => {
                  const trimmed = keyText.trim()
                  // Typing the reserved `schemaDefinition` key opens the schema editor.
                  if (trimmed === SCHEMA_DEFINITION_KEY) {
                    setEditingSchema(undefined)
                    setSchemaEditorOpen(true)
                  }
                  const cidText = trimmed.replace(/^ipfs:\/\//, '')
                  setPendingSchemaCid(schemaKeyCid(`ipfs://${cidText}`))
                }}
                onAdd={(key, value) => {
                  // schemaDefinition is authored via the schema editor dialog, not
                  // added as a plain field — never stage an empty string for it.
                  if (key.trim() === SCHEMA_DEFINITION_KEY) {
                    setEditingSchema(undefined)
                    setSchemaEditorOpen(true)
                    return
                  }
                  stage({[key]: value})
                  setPendingSchemaCid(null)
                }}
              />
            </>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">This document has no metadata.</p>
          ) : (
            <dl className="flex flex-col">
              {entries.map(([key, value]) => (
                <div key={key} className="border-border flex flex-col gap-1 border-b py-3 last:border-b-0">
                  <dt className={FIELD_LABEL_CLASS}>{key}</dt>
                  <dd>
                    <ValueDisplay value={value} rules={METADATA_VALUE_RULES} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </OnyxSchemaProvider>
    </ValueEditorProvider>
  )
}

/**
 * The row shown for the reserved `schemaDefinition` field: this document
 * describes a type. Instead of a raw ipfs:// string input, it names the type and
 * offers to edit its schema (in the schema editor) or detach it.
 */
function SchemaDefinitionRow({
  typeName,
  state,
  onOpen,
  onRemove,
}: {
  typeName?: string
  /** 'edit' = schema resolved; 'loading' = valid CID still fetching; 'define' =
   * empty/invalid value (recover by authoring a schema). */
  state: 'edit' | 'loading' | 'define'
  onOpen: () => void
  onRemove: () => void
}) {
  const title =
    state === 'define'
      ? 'This document describes a type'
      : typeName || (state === 'loading' ? 'Loading schema…' : 'Untitled type')
  const subtitle =
    state === 'define' ? 'No schema set yet — define one as a form.' : 'Its schema — edit it as a form, not raw JSON.'
  return (
    <div className="border-border flex items-center justify-between gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <FileCode2 className="text-muted-foreground size-4 shrink-0" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{subtitle}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={onOpen} disabled={state === 'loading'}>
          {state === 'define' ? 'Define schema' : 'Edit schema'}
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="Remove schema" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Inline bar for attaching a schema-typed metadata field: paste a schema's
 * ipfs:// URL, and the field is created with that URL as its KEY and a
 * schema-instantiated starter value (or an empty object until the schema
 * loads — the field's hints fill in as it arrives).
 */
function AttachSchemaFieldBar({
  existingKeys,
  registry,
  onPendingCid,
  onAttach,
  onCancel,
}: {
  existingKeys: string[]
  registry: Record<string, unknown>
  /** Reports a valid schema CID as it's typed, so the parent can prefetch it. */
  onPendingCid: (cid: string | null) => void
  onAttach: (key: string, value: unknown) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const cidText = text.trim().replace(/^ipfs:\/\//, '')
    const parsed = parseCidString(cidText)
    if (!parsed || !schemaKeyCid(`ipfs://${cidText}`)) {
      setError('Enter a schema CID or ipfs:// URL (schemas are DAG-CBOR blobs)')
      return
    }
    const key = `ipfs://${cidText}`
    if (existingKeys.includes(key)) {
      setError('This schema is already attached — edit its field below')
      return
    }
    // Seed from the schema when it's already fetched; otherwise start with an
    // empty object and let the hints populate once the schema loads. A
    // starter that metadata can't hold (lists/floats — the publish API
    // rejects them) falls back to an empty object; the advisory warnings
    // then guide the user within what metadata supports.
    const schema = registry[cidText]
    const starter = schema ? seedValue(schema as OnyxSchema) : undefined
    const usable = starter !== undefined && findInvalidValue(starter, METADATA_VALUE_RULES) === null
    onAttach(key, usable ? starter : {})
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={text}
          placeholder="Schema CID or ipfs:// URL"
          className="min-w-64 flex-1 font-mono text-xs"
          autoFocus
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
            const cidText = e.target.value.trim().replace(/^ipfs:\/\//, '')
            onPendingCid(schemaKeyCid(`ipfs://${cidText}`))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <Button size="sm" onClick={submit}>
          <Check className="size-4" />
          Attach
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** Whole-metadata JSON editor: full editing in one textarea, applied as a diff. */
function MetadataJsonEditor({
  metadata,
  editable,
  onMetadata,
}: {
  metadata: Record<string, unknown>
  editable: boolean
  onMetadata?: (patch: MetadataPatch) => void
}) {
  const currentVisible = useMemo(
    () => toCanonicalOrder(metadata, {hideNull: true}) as Record<string, unknown>,
    [metadata],
  )
  const serialized = useMemo(() => JSON.stringify(currentVisible, null, 2), [currentVisible])
  const [text, setText] = useState(serialized)
  useEffect(() => setText(serialized), [serialized])

  const validation = useMemo(() => {
    if (text === serialized) return {dirty: false as const}
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isPlainObject(parsed)) return {dirty: true as const, error: 'Metadata must be a JSON object'}
      const problem = findInvalidValue(parsed, METADATA_VALUE_RULES)
      if (problem) return {dirty: true as const, error: problem}
      return {dirty: true as const, value: parsed}
    } catch (e) {
      return {dirty: true as const, error: e instanceof Error ? e.message : 'Invalid JSON'}
    }
  }, [text, serialized])

  if (!editable) {
    return <pre className="bg-muted/50 overflow-x-auto rounded-md p-4 font-mono text-sm">{serialized}</pre>
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        rows={Math.max(8, Math.min(28, text.split('\n').length + 1))}
        spellCheck={false}
        className={cn('font-mono text-sm', validation.dirty && 'error' in validation && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-8 items-center gap-2">
        {validation.dirty ? (
          'error' in validation ? (
            <p className="text-destructive text-xs">{validation.error}</p>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => {
                  onMetadata!(diffMetadata(metadata, validation.value!))
                }}
              >
                <Check className="size-4" />
                Apply changes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setText(serialized)}>
                Reset
              </Button>
            </>
          )
        ) : (
          <p className="text-muted-foreground text-xs">
            Values may be text, whole numbers, true/false, or nested objects.
          </p>
        )}
      </div>
    </div>
  )
}
