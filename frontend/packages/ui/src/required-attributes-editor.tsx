// The required *custom* attributes declared by a document's CONFORMANCE schema,
// rendered above the body content in the Content tab. When a document conforms to
// a schema (via its `attributesSchema` metadata field, or a parent's `childAttributesSchema`), the
// schema's mandatory metadata fields (beyond the standard name/summary header
// fields and the schema-binding fields) are shown here as always-visible editable
// rows — so an author fills them in-place instead of hunting for the Attributes
// tab. Readers see the same rows read-only — the value, or "not set" for a missing
// one. The caller resolves the schema (see useEffectiveDocSchema) and passes its
// metadata sub-schema as `conformanceSchema`.
import {fieldSchema, requiredFieldNames} from './schema/engine'
import {useMemo} from 'react'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {seedValue} from './schema/data-editor'
import type {HypermediaSchema} from './schema/engine'
import {documentMetadataSchema} from './schema/metadata-schema-keys'
import {SchemaRegistryProvider} from './schema/schema-context'
import {RESERVED_METADATA_KEYS} from './schema/schema-document'
import {FIELD_LABEL_CLASS, FieldRow, METADATA_VALUE_RULES, ValueDisplay, ValueEditorProvider} from './value-editor'

/**
 * Renders the conformance schema's required custom attributes: editable rows with `onMetadata`,
 * read-only values without it.
 * Returns null when the document has no conformance schema, or the schema declares
 * no required custom fields — so callers can drop it in unconditionally.
 *
 * `conformanceSchema` is the resolved metadata schema (base ⊕ type). `metadata` is
 * the document's current (draft-merged) metadata; `onMetadata` stages a single
 * field patch (the same shape the Attributes tab publishes) — omit it for readers.
 */
export function RequiredAttributesEditor({
  conformanceSchema,
  metadata,
  onMetadata,
  openUrl,
}: {
  conformanceSchema: HypermediaSchema | undefined
  metadata: HMMetadata | undefined
  onMetadata?: (patch: Record<string, unknown>) => void
  /** Makes `hm://` values clickable. */
  openUrl?: (url: string) => void
}) {
  const current = (metadata ?? {}) as Record<string, unknown>

  const schemaRoot = useMemo(
    () => (conformanceSchema ? documentMetadataSchema(conformanceSchema, {}, {}) : undefined),
    [conformanceSchema],
  )

  const requiredKeys = useMemo(
    () => requiredFieldNames(schemaRoot).filter((k) => !RESERVED_METADATA_KEYS.has(k)),
    [schemaRoot],
  )
  const requiredRows = useMemo(
    () =>
      requiredKeys.map((key) => ({
        key,
        value: key in current && current[key] != null ? current[key] : seedValue(fieldSchema(schemaRoot, key) ?? {}),
      })),
    [requiredKeys, current, schemaRoot],
  )

  if (requiredRows.length === 0) return null

  if (!onMetadata) {
    return (
      <ValueEditorProvider openUrl={openUrl}>
        <dl
          className="border-border bg-muted/30 mb-4 flex flex-col rounded-lg border px-4 py-1"
          data-testid="required-attributes"
        >
          {requiredKeys.map((key) => (
            <div key={key} className="border-border flex flex-col gap-1 border-b py-3 last:border-b-0">
              <dt className={FIELD_LABEL_CLASS}>{key}</dt>
              <dd>
                {current[key] != null ? (
                  <ValueDisplay value={current[key]} rules={METADATA_VALUE_RULES} />
                ) : (
                  <span className="text-muted-foreground text-sm italic">not set</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </ValueEditorProvider>
    )
  }

  return (
    <ValueEditorProvider openUrl={openUrl}>
      <SchemaRegistryProvider schema={schemaRoot} registry={{}} value={current}>
        <div
          className="border-border bg-muted/30 mb-4 flex flex-col rounded-lg border px-4 py-1"
          data-testid="required-attributes"
        >
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
      </SchemaRegistryProvider>
    </ValueEditorProvider>
  )
}
