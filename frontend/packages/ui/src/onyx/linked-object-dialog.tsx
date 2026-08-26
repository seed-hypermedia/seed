// Create or edit an IPFS object referenced from a metadata field, in place.
//
// A metadata field with `format: ipfs` holds an `ipfs://<cid>` string. It can
// point at a file (uploaded) or at a DAG-CBOR *object* — a value authored
// right here. The dialog has three schema modes, decided by the field:
//   - REQUIRED: the field schema names a `target` type. The editor is locked to
//     that schema and publish is gated on validity.
//   - OPTIONAL: no target. Pick any schema (bundled library, or paste an
//     hm://type-doc / ipfs://schema reference) — validation is advisory.
//   - NONE: "free-form" — the schema-less DAG-CBOR editor; anything goes.
// The published blob carries a `schema: {"/": <cid>}` link when a schema with
// a known CID was used, so the inspector can validate it later (same
// convention as the raw-blob "New instance" page). Editing re-publishes: blobs
// are immutable, so the field is pointed at the new CID.
import * as cbor from '@ipld/dag-cbor'
import {useQuery} from '@tanstack/react-query'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useEffect, useMemo, useState} from 'react'
import {useUniversalClient} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '../button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '../components/dialog'
import {Input} from '../components/input'
import {dagJsonToIpld, isDagJsonLink} from '../dag-json'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '../select-dropdown'
import {Spinner} from '../spinner'
import {toast} from '../toast'
import {CBOR_VALUE_RULES, isPlainObject, ValueEditor, ValueEditorProvider} from '../value-editor'
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {isOnyxSchema, kindOf, nameToUrl, ONYX_SCHEMAS, validate} from './onyx-engine'
import {useResolvedSchema} from './onyx-schema-resolve'

const DAG_CBOR_CODE = 0x71
const FREE_FORM = ' free-form'
const CUSTOM_REF = ' custom'

/** Bundled schemas a person would plausibly instantiate: named structs, not meta/instances/unions. */
function instantiableLibrarySchemas(): {name: string; label: string}[] {
  return Object.entries(ONYX_SCHEMAS)
    .filter(([name, s]) => {
      if (name.startsWith('onyx-') || name.startsWith('seed-rpc')) return false
      if (s.$type !== undefined) return false // an instance file, not a schema
      if (s.anyOf) return false
      const kind = s.type ? kindOf(s.type) : s.ref ? 'map' : null
      return kind === 'map' && (s.properties || s.values)
    })
    .map(([name, s]) => ({name, label: typeof s.name === 'string' && s.name ? `${s.name} (${name})` : name}))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Encode a dag-json value as DAG-CBOR and publish it; returns the CID. */
export async function publishObject(
  client: ReturnType<typeof useUniversalClient>,
  value: unknown,
  schemaBlobCid?: string,
): Promise<string> {
  // A conforming object links to its schema so it stays self-describing.
  const body =
    schemaBlobCid && isPlainObject(value) && !isOnyxSchema(value) ? {...value, schema: {'/': schemaBlobCid}} : value
  const data = cbor.encode(dagJsonToIpld(body) as any)
  const digest = await sha256.digest(data)
  const cid = CID.createV1(DAG_CBOR_CODE, digest).toString()
  await client.request('PublishBlobs', {blobs: [{cid, data}]})
  return cid
}

/** Strip the `schema` self-link before validating/editing an existing object. */
function withoutSchemaLink(value: unknown): {value: unknown; schemaCid?: string} {
  if (!isPlainObject(value)) return {value}
  const link = value.schema
  if (!isDagJsonLink(link)) return {value}
  const {schema: _drop, ...rest} = value
  return {value: rest, schemaCid: link['/']}
}

export function LinkedObjectDialog({
  open,
  onOpenChange,
  target,
  existingCid,
  fieldLabel,
  onPublished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The field schema's `target`: the type the object must conform to (locks the schema). */
  target?: string
  /** Edit mode: the object currently referenced by the field. */
  existingCid?: string
  /** The field's name, for the dialog title. */
  fieldLabel?: string
  onPublished: (cid: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingCid ? 'Edit object' : 'New object'}
            {fieldLabel ? <span className="text-muted-foreground font-normal"> — {fieldLabel}</span> : null}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <LinkedObjectEditor
            key={existingCid ?? 'new'}
            target={target}
            existingCid={existingCid}
            onPublished={(cid) => {
              onPublished(cid)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LinkedObjectEditor({
  target,
  existingCid,
  onPublished,
}: {
  target?: string
  existingCid?: string
  onPublished: (cid: string) => void
}) {
  const client = useUniversalClient()

  // Edit mode: fetch the existing object; its own `schema` link (if any) is the
  // default schema when the field doesn't impose a target.
  const existing = useQuery({
    queryKey: [queryKeys.CID, existingCid],
    queryFn: async () => client.request('GetCID', {cid: existingCid!}),
    enabled: !!existingCid,
    staleTime: Infinity,
  })
  const existingParts = useMemo(
    () => (existing.data ? withoutSchemaLink((existing.data as {value?: unknown}).value) : null),
    [existing.data],
  )

  // Schema choice. `target` wins; otherwise the existing object's link, else the picker.
  const [choice, setChoice] = useState<string>(target ? target : FREE_FORM)
  const [customRef, setCustomRef] = useState('')
  useEffect(() => {
    if (!target && existingParts?.schemaCid) setChoice(`ipfs://${existingParts.schemaCid}`)
  }, [target, existingParts?.schemaCid])
  const schemaRef =
    choice === FREE_FORM
      ? null
      : choice === CUSTOM_REF
        ? customRef.trim() || null
        : choice.startsWith('hm://') || choice.startsWith('ipfs://')
          ? choice
          : nameToUrl(choice)
  const {schema, cid: schemaBlobCid, isLoading: schemaLoading} = useResolvedSchema(schemaRef)
  const locked = !!target
  const advisory = !locked

  // The value being authored. Seeded from the existing object (edit) or the schema.
  const [value, setValue] = useState<unknown>(undefined)
  const [seededFor, setSeededFor] = useState<string | null>(null)
  useEffect(() => {
    if (existingCid) {
      if (existingParts && value === undefined) setValue(existingParts.value)
      return
    }
    // A fresh object re-seeds when the schema changes (until the user has typed).
    const key = schemaRef ?? FREE_FORM
    if (seededFor === key) return
    if (schemaRef && !schema) return // still resolving
    setValue(schema ? seedValue(schema) : {})
    setSeededFor(key)
  }, [existingCid, existingParts, schema, schemaRef, seededFor, value])

  const errors = schema && value !== undefined ? validate(schema, value) : []
  const [publishing, setPublishing] = useState(false)
  const library = useMemo(instantiableLibrarySchemas, [])

  const publish = async () => {
    setPublishing(true)
    try {
      const cid = await publishObject(client, value, schema ? schemaBlobCid : undefined)
      toast.success(existingCid ? 'Object updated' : 'Object published')
      onPublished(cid)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  if (existingCid && existing.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <Spinner className="size-4" /> Loading object…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="linked-object-editor">
      {/* Schema line: locked to the target, or a picker. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Schema</span>
        {locked ? (
          <span className="bg-muted rounded-md px-2 py-1 font-mono text-xs" data-testid="linked-object-target">
            {typeof schema?.name === 'string' && schema.name ? schema.name : target}
            <span className="text-muted-foreground"> · required</span>
          </span>
        ) : (
          <>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="w-72" aria-label="Object schema">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FREE_FORM}>No schema (free-form data)</SelectItem>
                <SelectItem value={CUSTOM_REF}>Paste a schema reference…</SelectItem>
                {existingParts?.schemaCid && (
                  <SelectItem value={`ipfs://${existingParts.schemaCid}`}>
                    Attached schema (ipfs://{existingParts.schemaCid.slice(0, 10)}…)
                  </SelectItem>
                )}
                {library.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {choice === CUSTOM_REF && (
              <Input
                value={customRef}
                onChange={(e) => setCustomRef(e.target.value)}
                placeholder="hm://…/type-document or ipfs://<schema cid>"
                aria-label="Schema reference"
                className="w-80 font-mono text-xs"
              />
            )}
          </>
        )}
        {schemaLoading && <Spinner className="size-4" />}
        {schemaRef && !schema && !schemaLoading && <span className="text-destructive text-xs">schema not found</span>}
      </div>

      {/* The editor: schema-driven form, or the free-form DAG-CBOR editor. */}
      {value === undefined ? (
        <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
          <Spinner className="size-4" /> Resolving schema…
        </div>
      ) : schema ? (
        <OnyxDataEditor schema={schema} value={value} onValue={setValue} />
      ) : (
        <ValueEditorProvider>
          <ValueEditor value={value} onValue={setValue} rules={CBOR_VALUE_RULES} />
        </ValueEditorProvider>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className={errors.length ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
          {schema
            ? errors.length
              ? `${errors.length} issue${errors.length > 1 ? 's' : ''}${advisory ? ' (advisory)' : ' to resolve'}`
              : '✓ conforms to schema'
            : 'Free-form: any DAG-CBOR value'}
        </span>
        <Button
          size="sm"
          onClick={publish}
          disabled={publishing || value === undefined || (locked && errors.length > 0)}
          data-testid="linked-object-publish"
        >
          {publishing ? 'Publishing…' : existingCid ? 'Publish new version' : 'Publish & link'}
        </Button>
      </div>
    </div>
  )
}
