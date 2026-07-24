// Schema-awareness for a ValueEditor tree, on the Onyx engine. The Onyx port of
// blob-schema-context.tsx: strictly advisory (consumers render hints/warnings,
// never gate edits); without the provider every hook degrades to "schema says
// nothing". Fetching the schema graph is the page's job (see
// useOnyxSchemaRegistry); this module is pure React.
import {createContext, useContext, useMemo, type ReactNode} from 'react'
import {isDagJsonLink} from '../dag-json'
import type {ValuePath} from '../value-editor'
import {kindOf, resolveSchema, validate, type OnyxRegistry, type OnyxSchema} from './onyx-engine'

/** An advisory schema warning at a value path (Onyx port of v1's SchemaWarning). */
export type SchemaWarning = {path: (string | number)[]; message: string}

const warningKey = (path: (string | number)[]): string => JSON.stringify(path)

/** Parse an Onyx validate() error (`$.a.b[2]: message`) into a path + message. */
export function parseOnyxError(err: string): SchemaWarning {
  const idx = err.indexOf(': ')
  const pathStr = idx >= 0 ? err.slice(0, idx) : '$'
  const message = idx >= 0 ? err.slice(idx + 2) : err
  const path: (string | number)[] = []
  const body = pathStr.startsWith('$') ? pathStr.slice(1) : pathStr
  const re = /\.([^.[\]]+)|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) path.push(m[1])
    else if (m[2] !== undefined) path.push(Number(m[2]))
  }
  return {path, message}
}

/** Resolve the Onyx subschema governing the value at `path` (or 'unresolved'/undefined). */
export function onyxSubschema(
  root: OnyxSchema,
  path: ValuePath,
  registry: OnyxRegistry,
): OnyxSchema | 'unresolved' | undefined {
  let schema: OnyxSchema = root
  for (const seg of path) {
    const {schema: resolved} = resolveSchema(schema, {}, registry)
    if (!resolved || resolved.__missing || resolved.__unbound) return 'unresolved'
    if (resolved.anyOf) return 'unresolved' // can't statically pick a union variant
    const kind = resolved.type ? kindOf(resolved.type) : null
    if (kind === 'map') {
      const child = (typeof seg === 'string' && resolved.properties?.[seg]) || resolved.values
      if (!child) return undefined
      schema = child
    } else if (kind === 'list') {
      if (!resolved.items) return undefined
      schema = resolved.items
    } else {
      return undefined
    }
  }
  const {schema: resolved} = resolveSchema(schema, {}, registry)
  if (!resolved || resolved.__missing || resolved.__unbound) return 'unresolved'
  return resolved
}

type OnyxSchemaContextValue = {
  rootSchema: OnyxSchema
  registry: OnyxRegistry
  warningsByPath: Map<string, SchemaWarning[]>
}

const OnyxSchemaContext = createContext<OnyxSchemaContextValue | null>(null)

export function OnyxSchemaProvider({
  schema,
  registry,
  value,
  children,
}: {
  schema: OnyxSchema | undefined
  registry: OnyxRegistry
  value: unknown
  children: ReactNode
}) {
  const contextValue = useMemo(() => {
    if (!schema) return null
    // When the reserved schema-attachment key is a link itself, warnings about
    // it are app plumbing, not user data — suppress them.
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as any) : null
    const attachmentKey = obj && isDagJsonLink(obj.schema) ? 'schema' : null
    const warningsByPath = new Map<string, SchemaWarning[]>()
    for (const err of validate(schema, value, '$', {}, registry)) {
      const warning = parseOnyxError(err)
      // Suppress noise about the reserved attachment key: both a value warning
      // at ['schema'] and the closed-map "unexpected key" warning at the root.
      if (attachmentKey && warning.path.length === 1 && warning.path[0] === attachmentKey) continue
      if (attachmentKey && warning.path.length === 0 && warning.message.includes(`unexpected key "${attachmentKey}"`))
        continue
      const key = warningKey(warning.path)
      const existing = warningsByPath.get(key)
      if (existing) existing.push(warning)
      else warningsByPath.set(key, [warning])
    }
    return {rootSchema: schema, registry, warningsByPath}
  }, [schema, registry, value])
  return <OnyxSchemaContext.Provider value={contextValue}>{children}</OnyxSchemaContext.Provider>
}

const EMPTY_WARNINGS: SchemaWarning[] = []

/** Resolved Onyx subschema at a value path; undefined without a provider/schema. */
export function useSubschema(path: ValuePath): OnyxSchema | 'unresolved' | undefined {
  const ctx = useContext(OnyxSchemaContext)
  if (!ctx) return undefined
  return onyxSubschema(ctx.rootSchema, path, ctx.registry)
}

/** Advisory warnings for the node at a value path (empty when conforming). */
export function useSchemaWarnings(path: ValuePath): SchemaWarning[] {
  const ctx = useContext(OnyxSchemaContext)
  if (!ctx) return EMPTY_WARNINGS
  return ctx.warningsByPath.get(warningKey(path)) ?? EMPTY_WARNINGS
}

/** The attached root schema + registry, or null when editing schemaless. */
export function useOnyxSchema(): {rootSchema: OnyxSchema; registry: OnyxRegistry} | null {
  return useContext(OnyxSchemaContext)
}

/** Total warning count, for a summary badge. */
export function useSchemaWarningCount(): number {
  const ctx = useContext(OnyxSchemaContext)
  if (!ctx) return 0
  let count = 0
  ctx.warningsByPath.forEach((warnings) => {
    count += warnings.length
  })
  return count
}

/** Every schema warning across the tree (root-level first, then by path), for a
 * summary that lists the actual problems — not just a count. */
export function useAllSchemaWarnings(): SchemaWarning[] {
  const ctx = useContext(OnyxSchemaContext)
  return useMemo(() => {
    if (!ctx) return EMPTY_WARNINGS
    const all: SchemaWarning[] = []
    // Root path ([]) first — that's where "missing required" lands — then the rest.
    const root = ctx.warningsByPath.get(warningKey([]))
    if (root) all.push(...root)
    ctx.warningsByPath.forEach((warnings, key) => {
      if (key !== warningKey([])) all.push(...warnings)
    })
    return all
  }, [ctx])
}
