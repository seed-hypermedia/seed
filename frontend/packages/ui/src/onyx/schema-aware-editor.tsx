// The editor for a value that conforms to a schema — with one special case that
// is a rule, not a hardcoded field: when the schema IS the meta-schema (the
// value being edited is itself an Onyx schema), offer the struct FORM (type
// name, fields, kinds, required, targets, signed-blob toggle) instead of the
// generic data editor, with a JSON escape hatch. Used by the linked-object
// dialog and the blob page alike, so a `schemaDefinition` field — an ipfs
// reference whose target is the meta-schema — gets the form for free.
import {useState} from 'react'
import {BlobJsonMode} from '../blob-editor-parts'
import {Button} from '../button'
import {OnyxDataEditor} from './onyx-data-editor'
import {kindOf, ONYX_SCHEMAS, type OnyxRegistry, type OnyxSchema} from './onyx-engine'
import {emptyStructSchema, OnyxSchemaEditor} from './onyx-schema-editor'

/** True when `schema` is the bundled meta-schema — the value is a schema. */
export function isMetaSchema(schema: OnyxSchema | undefined): boolean {
  return !!schema && schema === ONYX_SCHEMAS['onyx-schema']
}

/** The struct form only fits map schemas (and ref-rooted extensions); unions etc. use JSON. */
function fitsStructForm(value: unknown): value is OnyxSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as OnyxSchema
  if (v.anyOf) return false
  return !v.type || kindOf(v.type) === 'map'
}

/** The starting value for a new object of `schema`: a blank struct when it's the meta-schema. */
export function seedForSchema(schema: OnyxSchema, seed: (s: OnyxSchema, reg?: OnyxRegistry) => unknown): unknown {
  return isMetaSchema(schema) ? emptyStructSchema() : seed(schema)
}

/** Problems the form itself insists on (beyond validation). A schema carries no name of its own —
 * its defining document names it — so nothing beyond meta-schema validation applies today. */
export function schemaFormProblems(_schema: OnyxSchema | undefined, _value: unknown): string[] {
  return []
}

export function SchemaAwareEditor({
  schema,
  value,
  onValue,
  registry,
}: {
  schema: OnyxSchema
  value: unknown
  onValue: (v: unknown) => void
  registry?: OnyxRegistry
}) {
  const [json, setJson] = useState(false)
  if (!isMetaSchema(schema) || !fitsStructForm(value)) {
    return <OnyxDataEditor schema={schema} value={value} onValue={onValue} registry={registry} />
  }
  return (
    <div className="flex flex-col gap-3" data-testid="schema-form">
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant={json ? 'ghost' : 'outline'} onClick={() => setJson(false)}>
          Form
        </Button>
        <Button size="sm" variant={json ? 'outline' : 'ghost'} onClick={() => setJson(true)}>
          JSON
        </Button>
      </div>
      {json ? (
        <BlobJsonMode
          value={value}
          onApply={(next) => {
            onValue(next)
            setJson(false)
          }}
          onCancel={() => setJson(false)}
        />
      ) : (
        <OnyxSchemaEditor schema={value} onSchema={onValue} hideModeToggle />
      )}
    </div>
  )
}
