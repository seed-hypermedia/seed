// The shared Onyx tour page body, reused by the desktop and web app pages. Given
// the current schema slug and a navigate callback, it renders the full schema
// explorer plus a live, schema-respecting data/schema editor under each schema.
import {isInstance, ONYX_SCHEMAS, refToName} from './onyx-engine'
import {OnyxDataEditorPanel} from './onyx-data-editor'
import {OnyxExplorer} from './onyx-explorer'
import {OnyxRpcConsole, RpcCallPanel, rpcMethodForSlug} from './onyx-rpc-console'

/** The live schema-respecting editor shown under each schema page: the meta-schema
 * builds a schema (self-hosting), an instance seeds from its value, anything else
 * builds a value — all validated on every keystroke by the ported Onyx engine. */
function SchemaEditorSection({slug}: {slug: string}) {
  const schema = ONYX_SCHEMAS[slug]
  if (!schema) return null
  // The RPC pages are live: the union page is the full API console, and each
  // method page is a call panel for that method — inputs edited by the standard
  // schema-respecting editor, responses validated against the output schema.
  if (slug === 'seed-rpc') {
    return (
      <section className="border-border mt-6 border-t pt-4">
        <h2 className="mb-2 text-sm font-semibold">API console · call any method of this union</h2>
        <OnyxRpcConsole />
      </section>
    )
  }
  const rpcMethod = rpcMethodForSlug(slug)
  if (rpcMethod) {
    return (
      <section className="border-border mt-6 border-t pt-4">
        <h2 className="mb-2 text-sm font-semibold">Call {rpcMethod.key} · live, against this app's API</h2>
        <RpcCallPanel key={slug} method={rpcMethod} />
      </section>
    )
  }
  if (isInstance(schema)) {
    const typeName = refToName(schema.$type)
    const typeSchema = ONYX_SCHEMAS[typeName]
    if (!typeSchema) return null
    return (
      <section className="border-border mt-6 border-t pt-4">
        <h2 className="mb-2 text-sm font-semibold">Data editor · seeded from this instance</h2>
        <OnyxDataEditorPanel key={slug} schema={typeSchema} initialValue={schema.value} label={`Build a ${typeName}`} />
      </section>
    )
  }
  const isMeta = slug === 'onyx-schema'
  return (
    <section className="border-border mt-6 border-t pt-4">
      <h2 className="mb-2 text-sm font-semibold">
        {isMeta ? 'Schema editor' : 'Data editor'} · live, validated by the ported engine
      </h2>
      <OnyxDataEditorPanel key={slug} schema={schema} label={isMeta ? 'Build a schema' : 'Build data'} />
    </section>
  )
}

export function OnyxTour({slug, onNavigate}: {slug: string; onNavigate: (slug: string) => void}) {
  return (
    <div className="h-full max-h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-bold">Onyx — the schema tour</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          A self-describing type system for content-addressed data. Browse every schema — every reference is a link, and
          each page has a live, schema-respecting editor.
        </p>
        <OnyxExplorer
          initialSlug={slug}
          onSlugChange={onNavigate}
          belowPage={(s) => <SchemaEditorSection slug={s} />}
        />
      </div>
    </div>
  )
}
