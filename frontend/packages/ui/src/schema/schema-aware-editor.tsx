// The editor for a value that conforms to a schema — with one special case that
// is a rule, not a hardcoded field: when the schema IS the meta-schema (the
// value being edited is itself a Hypermedia schema), offer the struct FORM (type
// name, fields, kinds, required, targets, signed-blob toggle) instead of the
// generic data editor, with a JSON escape hatch. Used by the linked-object
// dialog and the blob page alike, so a `schemaDefinition` field — an ipfs
// reference whose target is the meta-schema — gets the form for free.
import {useState} from 'react'
import {BlobJsonMode} from '../blob-editor-parts'
import {Button} from '../button'
import {SchemaDataEditor} from './data-editor'
import {kindOf, HM_SCHEMAS, type SchemaRegistry, type HypermediaSchema} from './engine'
import {emptyStructSchema, SchemaEditor} from './schema-editor'

/** True when `schema` is the bundled meta-schema — the value is a schema. */
export function isMetaSchema(schema: HypermediaSchema | undefined): boolean {
  return !!schema && schema === HM_SCHEMAS['schema/meta-schema']
}

/** The struct form only fits map schemas (and ref-rooted extensions); unions etc. use JSON. */
function fitsStructForm(value: unknown): value is HypermediaSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as HypermediaSchema
  if (v.anyOf) return false
  return !v.type || kindOf(v.type) === 'map' || kindOf(v.type) === 'struct'
}

/** The starting value for a new object of `schema`: a blank struct when it's the meta-schema. */
export function seedForSchema(
  schema: HypermediaSchema,
  seed: (s: HypermediaSchema, reg?: SchemaRegistry) => unknown,
): unknown {
  return isMetaSchema(schema) ? emptyStructSchema() : seed(schema)
}

/** Problems the form itself insists on (beyond validation). A schema carries no name of its own —
 * its defining document names it — so nothing beyond meta-schema validation applies today. */
export function schemaFormProblems(_schema: HypermediaSchema | undefined, _value: unknown): string[] {
  return []
}

export function SchemaAwareEditor({
  schema,
  value,
  onValue,
  registry,
}: {
  schema: HypermediaSchema
  value: unknown
  onValue: (v: unknown) => void
  registry?: SchemaRegistry
}) {
  const [json, setJson] = useState(false)
  if (!isMetaSchema(schema) || !fitsStructForm(value)) {
    return <SchemaDataEditor schema={schema} value={value} onValue={onValue} registry={registry} />
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
        <SchemaEditor schema={value} onSchema={onValue} hideModeToggle />
      )}
    </div>
  )
}
