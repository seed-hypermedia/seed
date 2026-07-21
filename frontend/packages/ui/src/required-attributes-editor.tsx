// The required *custom* attributes declared by a document's schema, rendered
// above the body content in the Content tab. When a document links a schema via
// `schemaDefinition`, the schema's mandatory fields (beyond the standard
// name/summary header fields) are shown here as always-visible editable rows —
// so an author fills them in-place instead of hunting for the Attributes tab.
// Standard fields (name/summary) live in the header; the schemaDefinition field
// itself is authored via the schema editor, so both are excluded here.
import {useMemo} from 'react'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {seedValue} from './onyx/onyx-data-editor'
import type {OnyxSchema} from './onyx/onyx-engine'
import {documentMetadataSchema} from './onyx/onyx-metadata-schema-keys'
import {OnyxSchemaProvider} from './onyx/onyx-schema-context'
import {useOnyxSchemaRegistry} from './onyx/onyx-schema-registry-cid'
import {SCHEMA_DEFINITION_KEY, schemaDefinitionCid} from './onyx/schema-document'
import {FieldRow, METADATA_VALUE_RULES, ValueEditorProvider} from './value-editor'

/** Standard header fields the title/summary inputs already own. */
const HEADER_FIELDS = new Set(['name', 'summary', SCHEMA_DEFINITION_KEY])

/**
 * Renders the schema's required custom attributes as editable rows. Returns null
 * when the document has no schema, or the schema declares no required custom
 * fields — so callers can drop it in unconditionally.
 *
 * `metadata` is the document's current (draft-merged) metadata; `onMetadata`
 * stages a single-field patch (the same shape the Attributes tab publishes).
 */
export function RequiredAttributesEditor({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata | undefined
  onMetadata: (patch: Record<string, unknown>) => void
}) {
  const current = (metadata ?? {}) as Record<string, unknown>
  const schemaDefCid = schemaDefinitionCid(current)
  const seedCids = useMemo(() => (schemaDefCid ? [schemaDefCid] : []), [schemaDefCid])
  const {byCid} = useOnyxSchemaRegistry(seedCids)
  const schemaDefSchema = schemaDefCid ? byCid[schemaDefCid] : undefined

  const schemaRoot = useMemo(
    () => (schemaDefSchema ? documentMetadataSchema(schemaDefSchema, {}, byCid) : undefined),
    [schemaDefSchema, byCid],
  )

  const requiredKeys = useMemo(
    () =>
      (Array.isArray(schemaRoot?.required) ? (schemaRoot!.required as string[]) : []).filter(
        (k) => !HEADER_FIELDS.has(k),
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

  if (requiredRows.length === 0) return null

  return (
    <ValueEditorProvider>
      <OnyxSchemaProvider schema={schemaRoot} registry={{}} value={current}>
        <div className="border-border bg-muted/30 mb-4 flex flex-col rounded-lg border px-4 py-1">
          {requiredRows.map(({key, value}) => (
            <FieldRow
              key={key}
              className="border-border border-b py-3 last:border-b-0"
              fieldKey={key}
              value={value}
              // Schema-required fields are always present and cannot be removed;
              // their name is fixed by the schema.
              canRemove={false}
              siblingKeys={requiredKeys.filter((k) => k !== key)}
              onValue={(newValue) => onMetadata({[key]: newValue})}
              onEditField={(_newKey, newValue) => onMetadata({[key]: newValue})}
              onRemove={() => {}}
              rules={METADATA_VALUE_RULES}
              path={[key]}
            />
          ))}
        </div>
      </OnyxSchemaProvider>
    </ValueEditorProvider>
  )
}
