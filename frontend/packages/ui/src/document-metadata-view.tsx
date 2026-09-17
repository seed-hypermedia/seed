import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {fieldSchema, requiredFieldNames, structFields} from './schema/engine'
import {Braces, Check} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {seedValue} from './schema/data-editor'
import {SchemaRegistryProvider} from './schema/schema-context'
import {SchemaErrorSummary} from './schema/value-editor-schema'
import {RESERVED_METADATA_KEYS, SCHEMA_DEFINITION_KEY} from './schema/schema-document'
import {BINDING_SCHEMA_KEYS} from '@shm/shared/models/schema-draft'
import {
  buildSchemaKeyRoot,
  collectSchemaKeyCids,
  documentMetadataSchema,
  schemaKeyCid,
} from './schema/metadata-schema-keys'
import {useSchemaRegistry} from './schema/schema-registry-cid'
import type {HypermediaSchema} from './schema/engine'
import {Button} from './button'
import {Textarea} from './components/textarea'
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
  MetadataDirectEditContext,
  type MetadataDirectEdit,
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
      // A null tombstone and an unset (undefined) key both mean the field is absent.
      if (v === null || v === undefined) continue
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
  openUrl,
  onCreateBlob,
  directEdit,
  addRawFieldOpen,
  onAddRawFieldOpenChange,
}: {
  metadata?: HMMetadata | null
  canEdit?: boolean
  onMetadata?: (patch: MetadataPatch) => void
  /**
   * The resolved metadata schema this document must CONFORM to (from its own
   * `attributesSchema` field, or a parent's `childAttributesSchema`) — drives required fields and
   * advisory validation. Resolved by the caller (see useEffectiveDocSchema);
   * distinct from `schemaDefinition`, which is a schema this document DEFINES.
   */
  conformanceSchema?: HypermediaSchema
  /** Uploads a file dropped onto a string field to IPFS, returning its CID. */
  fileUpload?: (file: File) => Promise<string>
  /** Opens an uploaded IPFS file (by CID) in its own dedicated viewer window. */
  openFile?: (cid: string) => void
  /** Navigates to a hypermedia URL — makes `hm://` reference fields clickable. */
  openUrl?: (url: string) => void
  /** Opens a blank blob editor (new IPFS object) in its own window. */
  onCreateBlob?: () => void
  /**
   * Direct, in-context editing of IPFS objects referenced by metadata fields
   * (schemaDefinition and friends): opens the blob page in the field's context;
   * publishing updates the document's metadata directly, bypassing its draft.
   * Absent for unpublished documents.
   */
  directEdit?: MetadataDirectEdit
  /**
   * The "Add Raw Field" dialog, opened from the document options menu on the Attributes page.
   * Fields normally come from the attributes schema; this adds one outside it. When the caller
   * does not control it, no top-level add affordance is shown.
   */
  addRawFieldOpen?: boolean
  onAddRawFieldOpenChange?: (open: boolean) => void
}) {
  const [jsonMode, setJsonMode] = useState(false)
  const current = useMemo(() => (metadata ?? {}) as Record<string, unknown>, [metadata])
  // Null tombstones = absent, so validate against a null-stripped copy.
  const validationValue = useMemo(() => stripNullsDeep(current), [current])
  // The two schema bindings are shown and edited by their own sections above the rows.
  // The schema bindings and the schema definition are shown and edited by their own sections.
  const entries = canonicalEntries(current, {hideNull: true}).filter(
    ([key]) => key !== SCHEMA_DEFINITION_KEY && !(BINDING_SCHEMA_KEYS as readonly string[]).includes(key),
  )
  const editable = canEdit && !!onMetadata

  // Schema-keyed fields: a key in the `ipfs://<schemaCid>` form means the
  // value is expected to conform to that schema. Fetch those schemas and
  // synthesize a root schema so the rows get advisory hints and warnings.
  // A schema being typed into the attach bar prefetches too, so attaching
  // can seed the field from the schema immediately.
  const [pendingSchemaCid, setPendingSchemaCid] = useState<string | null>(null)
  const visibleKeys = entries.map(([key]) => key)
  const keysDep = visibleKeys.join('\n')
  const seedCids = useMemo(() => {
    const cids = collectSchemaKeyCids(visibleKeys)
    if (pendingSchemaCid && !cids.includes(pendingSchemaCid)) cids.push(pendingSchemaCid)
    return cids
  }, [keysDep, pendingSchemaCid])
  const {byCid} = useSchemaRegistry(seedCids)
  // The metadata schema that drives field suggestions + advisory validation is
  // the document's CONFORMANCE schema (its `attributesSchema`, or a parent's
  // `childAttributesSchema`), resolved by the caller and passed as `conformanceSchema`.
  // Its metadata EXTENDS the base document-metadata schema (`metadata`):
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
    // their semantic types (e.g. `attributesSchema`/`childAttributesSchema` render as HM-link
    // pills, `icon`/`cover` as IPFS files) even without a conformance schema; the
    // conformance schema (if any) adds/refines on top.
    return documentMetadataSchema(
      conformanceSchema ?? {},
      Object.fromEntries(structFields(keyRoot).map((f) => [f.name, f.schema])),
      byCid,
    )
  }, [keysDep, pendingSchemaCid, byCid, conformanceSchema])

  // The fields the conformance schema declares are ALWAYS shown (seeded if absent), so the user
  // never has to "add" a field the type already names: required ones first, then the optional ones
  // in schema order. A seeded value is only written once edited. Header fields (name/summary) and
  // the schema-binding fields live elsewhere / are authored specially, so they're excluded.
  const requiredKeys = useMemo(
    () => requiredFieldNames(schemaRoot).filter((k) => !RESERVED_METADATA_KEYS.has(k)),
    [schemaRoot],
  )
  const optionalSchemaKeys = useMemo(
    () =>
      structFields(conformanceSchema)
        .map((f) => f.name)
        .filter((k) => !RESERVED_METADATA_KEYS.has(k) && !requiredKeys.includes(k)),
    [conformanceSchema, requiredKeys],
  )
  const schemaRows = useMemo(
    () =>
      [...requiredKeys, ...optionalSchemaKeys].map((key) => {
        const present = key in current && current[key] != null
        return {
          key,
          required: requiredKeys.includes(key),
          present,
          value: present ? current[key] : seedValue(fieldSchema(schemaRoot, key) ?? {}),
        }
      }),
    [requiredKeys, optionalSchemaKeys, current, schemaRoot],
  )
  const schemaKeySet = useMemo(() => new Set(schemaRows.map((r) => r.key)), [schemaRows])
  const otherEntries = useMemo(() => entries.filter(([k]) => !schemaKeySet.has(k)), [entries, schemaKeySet])

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
      openUrl={openUrl}
      onCreateBlob={editable ? onCreateBlob : undefined}
    >
      <MetadataDirectEditContext.Provider value={directEdit ?? null}>
        <SchemaRegistryProvider schema={schemaRoot} registry={{}} value={validationValue}>
          <div className="flex flex-col gap-4 py-6">
            {/* No title here — the tab/breadcrumb (main view) and the panel header
              already label this "Attributes". */}
            {editable && <SchemaErrorSummary />}
            <div className="flex items-center justify-end">
              <div className="flex items-center gap-1">
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
            {jsonMode ? (
              <MetadataJsonEditor metadata={current} editable={editable} onMetadata={editable ? stage : undefined} />
            ) : editable ? (
              <>
                {schemaRows.length === 0 && otherEntries.length === 0 ? (
                  <p className="text-muted-foreground text-sm">This document has no metadata.</p>
                ) : (
                  <div className="flex flex-col">
                    {/* The schema's fields come first and are ALWAYS shown (seeded if the
                      value is absent), so a field the type declares never has to be
                      "added" by hand. */}
                    {schemaRows.map(({key, value, required, present}) => (
                      <FieldRow
                        key={key}
                        className="border-border border-b py-3 last:border-b-0"
                        fieldKey={key}
                        value={value}
                        // Schema fields keep the name the schema gives them. A required one
                        // cannot be removed; an optional one can be cleared once set.
                        canRemove={!required && present}
                        siblingKeys={entries.map(([k]) => k).filter((k) => k !== key)}
                        onValue={(newValue) => stage({[key]: newValue})}
                        onEditField={(_newKey, newValue) => stage({[key]: newValue})}
                        onRemove={() => stage({[key]: null})}
                        rules={METADATA_VALUE_RULES}
                        path={[key]}
                      />
                    ))}
                    {otherEntries.map(([key, value]) => (
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
                    ))}
                  </div>
                )}
                <AddFieldForm
                  hideTrigger
                  open={!!addRawFieldOpen}
                  onOpenChange={(next) => onAddRawFieldOpenChange?.(next)}
                  rules={METADATA_VALUE_RULES}
                  path={[]}
                  existingKeys={[...entries.map(([key]) => key), ...Array.from(schemaKeySet)]}
                  onKeyTextChange={(keyText) => {
                    const cidText = keyText.trim().replace(/^ipfs:\/\//, '')
                    setPendingSchemaCid(schemaKeyCid(`ipfs://${cidText}`))
                  }}
                  onAdd={(key, value) => {
                    stage({[key]: value})
                    setPendingSchemaCid(null)
                  }}
                />
              </>
            ) : schemaRows.length === 0 && entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">This document has no metadata.</p>
            ) : (
              <dl className="flex flex-col">
                {schemaRows.map(({key, value, present}) => (
                  <div key={key} className="border-border flex flex-col gap-1 border-b py-3 last:border-b-0">
                    <dt className={FIELD_LABEL_CLASS}>{key}</dt>
                    <dd>
                      {present ? (
                        <ValueDisplay value={value} rules={METADATA_VALUE_RULES} />
                      ) : (
                        <span className="text-muted-foreground text-sm italic">not set</span>
                      )}
                    </dd>
                  </div>
                ))}
                {otherEntries.map(([key, value]) => (
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
        </SchemaRegistryProvider>
      </MetadataDirectEditContext.Provider>
    </ValueEditorProvider>
  )
}

/**
 * The row shown for the reserved `schemaDefinition` field: this document
 * describes a type. Instead of a raw ipfs:// string input, it names the type and
 * offers to edit its schema (in the schema editor) or detach it.
 */

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
