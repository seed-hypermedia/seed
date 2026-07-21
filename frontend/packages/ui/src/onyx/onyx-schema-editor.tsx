// A purpose-built GUI for authoring an Onyx schema — presented as a struct (a
// named type with a list of fields), NOT as raw schema JSON. Each field has a
// name, a kind, and a `required` checkbox (the schema's `required` array is
// derived from the checkboxes). A "JSON" escape hatch reveals the raw editor for
// shapes the struct form doesn't cover (unions, generics, nesting). Kept visually
// minimal and consistent with the value editor that renders the forms this
// schema defines.
import * as cbor from '@ipld/dag-cbor'
import {Braces, Plus, X} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useState} from 'react'
import {useUniversalClient} from '@shm/shared'
import {Button} from '../button'
import {Checkbox} from '../components/checkbox'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '../components/dialog'
import {Input} from '../components/input'
import {dagJsonToIpld} from '../dag-json'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '../select-dropdown'
import {toast} from '../toast'
import {Tooltip} from '../tooltip'
import {cn} from '../utils'
import {OnyxDataEditor} from './onyx-data-editor'
import {kindOf, kindUrl, MAP_URL, ONYX_SCHEMAS, refToName, validate, type OnyxSchema} from './onyx-engine'

const DAG_CBOR_CODE = 0x71

/** The field kinds a struct property can take (friendly labels). */
const FIELD_KINDS: {kind: string; label: string}[] = [
  {kind: 'string', label: 'Text'},
  {kind: 'integer', label: 'Whole number'},
  {kind: 'float', label: 'Number'},
  {kind: 'boolean', label: 'Toggle'},
  {kind: 'link', label: 'IPFS link'},
  {kind: 'bytes', label: 'Bytes'},
  {kind: 'list', label: 'List'},
  {kind: 'map', label: 'Object'},
]

/** The kind a property schema declares (best-effort; defaults to text). */
function propKind(ps: any): string {
  if (ps?.type) return kindOf(ps.type)
  if (typeof ps?.ref === 'string') {
    const name = refToName(ps.ref)
    if (name.startsWith('onyx-')) return name.slice(5)
  }
  return 'string'
}

/** The property schema for a chosen kind. */
function kindSchema(kind: string): OnyxSchema {
  if (kind === 'list') return {type: kindUrl('list'), items: {}}
  if (kind === 'map') return {type: MAP_URL, values: {}}
  return {type: kindUrl(kind)}
}

/** An empty starter struct schema. */
export const emptyStructSchema = (): OnyxSchema => ({type: MAP_URL, name: '', properties: {}, required: []})

export function OnyxSchemaEditor({schema, onSchema}: {schema: OnyxSchema; onSchema: (s: OnyxSchema) => void}) {
  const properties: Record<string, any> = schema.properties ?? {}
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const entries = Object.entries(properties)

  const commit = (nextProps: Record<string, any>, nextRequired: Set<string>) => {
    // Drop required entries whose field no longer exists.
    const req = Array.from(nextRequired).filter((k) => k in nextProps)
    onSchema({...schema, type: MAP_URL, properties: nextProps, ...(req.length ? {required: req} : {required: []})})
  }
  const renameField = (oldName: string, newName: string) => {
    if (newName === oldName || newName in properties) return
    // Preserve order while renaming the key.
    const nextProps: Record<string, any> = {}
    for (const [k, v] of entries) nextProps[k === oldName ? newName : k] = v
    const nextRequired = new Set(required)
    if (nextRequired.delete(oldName)) nextRequired.add(newName)
    commit(nextProps, nextRequired)
  }
  const setFieldKind = (name: string, kind: string) => commit({...properties, [name]: kindSchema(kind)}, required)
  const setRequired = (name: string, on: boolean) => {
    const next = new Set(required)
    if (on) next.add(name)
    else next.delete(name)
    commit(properties, next)
  }
  const removeField = (name: string) => {
    const nextProps = {...properties}
    delete nextProps[name]
    const next = new Set(required)
    next.delete(name)
    commit(nextProps, next)
  }
  const addField = () => {
    let n = 1
    let name = 'field'
    while (name in properties) name = `field${++n}`
    commit({...properties, [name]: kindSchema('string')}, required)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">Type name</label>
        <Input
          value={typeof schema.name === 'string' ? schema.name : ''}
          placeholder="e.g. Employee"
          onChange={(e) => onSchema({...schema, name: e.target.value})}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">Description</label>
        <Input
          value={typeof schema.description === 'string' ? schema.description : ''}
          placeholder="What this type represents (optional)"
          onChange={(e) => onSchema({...schema, description: e.target.value || undefined})}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">Fields</label>
        <div className="flex flex-col gap-1.5">
          {entries.length === 0 && <p className="text-muted-foreground text-sm">No fields yet.</p>}
          {entries.map(([name, ps], index) => (
            // Stable index key: renaming changes the property name but not the
            // row's identity, so the (controlled) name input never remounts and
            // keeps focus while typing.
            <div key={index} className="flex items-center gap-2">
              <Input
                value={name}
                className="flex-1 font-mono text-sm"
                aria-label="Field name"
                onChange={(e) => renameField(name, e.target.value)}
              />
              <Select value={propKind(ps)} onValueChange={(kind) => setFieldKind(name, kind)}>
                <SelectTrigger className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_KINDS.map(({kind, label}) => (
                    <SelectItem key={kind} value={kind}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip content="Required — a value of this type must include this field">
                <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs">
                  <Checkbox checked={required.has(name)} onCheckedChange={(on) => setRequired(name, on === true)} />
                  required
                </label>
              </Tooltip>
              <Button variant="ghost" size="iconSm" aria-label={`Remove ${name}`} onClick={() => removeField(name)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-1 w-fit gap-1" onClick={addField}>
          <Plus className="size-4" /> Add field
        </Button>
      </div>
    </div>
  )
}

/** Publish an Onyx schema as a DAG-CBOR blob, returning its CID. */
async function publishSchema(client: ReturnType<typeof useUniversalClient>, schema: OnyxSchema): Promise<string> {
  const clean = {...schema}
  if (!clean.description) delete (clean as any).description
  const data = cbor.encode(dagJsonToIpld(clean) as any)
  const digest = await sha256.digest(data)
  const cid = CID.createV1(DAG_CBOR_CODE, digest).toString()
  await client.request('PublishBlobs', {blobs: [{cid, data}]})
  return cid
}

/**
 * The schema editor in a dialog — used to CREATE a new type or EDIT an existing
 * one. Struct form by default, with a JSON toggle for advanced shapes. On save it
 * publishes the schema blob and calls `onSaved(cid)`.
 */
export function SchemaEditorDialog({
  open,
  onOpenChange,
  initialSchema,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seed for editing an existing schema; omit to define a new one. */
  initialSchema?: OnyxSchema
  onSaved: (cid: string) => void
}) {
  const client = useUniversalClient()
  const editing = !!initialSchema
  const [schema, setSchema] = useState<OnyxSchema>(() => initialSchema ?? emptyStructSchema())
  const [jsonMode, setJsonMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const errors = validate(ONYX_SCHEMAS['onyx-schema'], schema)
  // The struct form only fits map schemas; unions/generics/etc. must use JSON.
  const isStruct = kindOf(schema.type ?? '') === 'map' || !schema.type
  const nameMissing = !(typeof schema.name === 'string' && schema.name.trim())

  const save = async () => {
    setSaving(true)
    try {
      onSaved(await publishSchema(client, schema))
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish schema')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit schema' : 'Define a type'}</DialogTitle>
        </DialogHeader>
        <div className="mb-2 flex justify-end">
          <Button
            variant={jsonMode ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1"
            onClick={() => setJsonMode((m) => !m)}
            disabled={!isStruct && jsonMode}
          >
            <Braces className="size-4" /> {jsonMode ? 'Form' : 'JSON'}
          </Button>
        </div>
        {jsonMode || !isStruct ? (
          <OnyxDataEditor
            schema={ONYX_SCHEMAS['onyx-schema']}
            value={schema}
            onValue={(v) => setSchema(v as OnyxSchema)}
          />
        ) : (
          <OnyxSchemaEditor schema={schema} onSchema={setSchema} />
        )}
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className={cn('text-xs', errors.length ? 'text-destructive' : 'text-green-600')}>
            {errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''} — not yet valid` : '✓ valid schema'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || errors.length > 0 || nameMissing}>
              {saving ? 'Publishing…' : editing ? 'Save & republish' : 'Create type'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
