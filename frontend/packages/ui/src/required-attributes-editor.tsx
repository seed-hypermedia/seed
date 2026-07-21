// The required *custom* attributes declared by a document's CONFORMANCE schema,
// rendered above the body content in the Content tab. When a document conforms to
// a schema (via its `schema` metadata field, or a parent's `childrenSchema`), the
// schema's mandatory metadata fields (beyond the standard name/summary header
// fields and the schema-binding fields) are shown here as always-visible editable
// rows — so an author fills them in-place instead of hunting for the Attributes
// tab. The caller resolves the schema (see useEffectiveDocSchema) and passes its
// metadata sub-schema as `conformanceSchema`.
import {useMemo} from 'react'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {seedValue} from './onyx/onyx-data-editor'
import type {OnyxSchema} from './onyx/onyx-engine'
import {documentMetadataSchema} from './onyx/onyx-metadata-schema-keys'
import {OnyxSchemaProvider} from './onyx/onyx-schema-context'
import {RESERVED_METADATA_KEYS} from './onyx/schema-document'
import {FieldRow, METADATA_VALUE_RULES, ValueEditorProvider} from './value-editor'

/**
 * Renders the conformance schema's required custom attributes as editable rows.
 * Returns null when the document has no conformance schema, or the schema declares
 * no required custom fields — so callers can drop it in unconditionally.
 *
 * `conformanceSchema` is the resolved metadata schema (base ⊕ type). `metadata` is
 * the document's current (draft-merged) metadata; `onMetadata` stages a single
 * field patch (the same shape the Attributes tab publishes).
 */
export function RequiredAttributesEditor({
  conformanceSchema,
  metadata,
  onMetadata,
}: {
  conformanceSchema: OnyxSchema | undefined
  metadata: HMMetadata | undefined
  onMetadata: (patch: Record<string, unknown>) => void
}) {
  const current = (metadata ?? {}) as Record<string, unknown>

  const schemaRoot = useMemo(
    () => (conformanceSchema ? documentMetadataSchema(conformanceSchema, {}, {}) : undefined),
    [conformanceSchema],
  )

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
