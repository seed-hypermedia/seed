import {createContext, useContext, useMemo, type ReactNode} from 'react'
import {resolveSubschema, validateValue, type BlobSchema, type SchemaRegistry, type SchemaWarning} from './blob-schema'
import {isDagJsonLink} from './dag-json'
import type {ValuePath} from './value-editor'

/**
 * Schema-awareness for a ValueEditor tree. Strictly advisory: consumers render
 * hints and warnings, never gate edits. Render without the provider (or with
 * schema undefined) for plain schemaless editing — every hook degrades to
 * "schema says nothing". Fetching the schema graph is the page's job (see
 * useSchemaRegistry in the desktop app); this module is pure React.
 */

function warningKey(path: ValuePath): string {
  return JSON.stringify(path)
}

type BlobSchemaContextValue = {
  rootSchema: BlobSchema
  registry: SchemaRegistry
  warningsByPath: Map<string, SchemaWarning[]>
}

const BlobSchemaContext = createContext<BlobSchemaContextValue | null>(null)

export function BlobSchemaProvider({
  schema,
  registry,
  value,
  children,
}: {
  schema: BlobSchema | undefined
  registry: SchemaRegistry
  value: unknown
  children: ReactNode
}) {
  // Warnings are computed once at the root per committed value change (commits
  // are blur-driven) and distributed as a path-keyed map, matching the
  // editor's top-down immutable rebuild.
  const contextValue = useMemo(() => {
    if (!schema) return null
    // When the top-level `schema` key is the attachment link itself, warnings
    // about it are noise (app plumbing, not user data). Any other shape at
    // that key is user data and warns normally.
    const schemaKeyIsAttachment =
      !!value && typeof value === 'object' && !Array.isArray(value) && isDagJsonLink((value as any).schema)
    const warningsByPath = new Map<string, SchemaWarning[]>()
    for (const warning of validateValue(value, schema, registry)) {
      if (schemaKeyIsAttachment && warning.path.length === 1 && warning.path[0] === 'schema') continue
      const key = warningKey(warning.path)
      const existing = warningsByPath.get(key)
      if (existing) existing.push(warning)
      else warningsByPath.set(key, [warning])
    }
    return {rootSchema: schema, registry, warningsByPath}
  }, [schema, registry, value])
  return <BlobSchemaContext.Provider value={contextValue}>{children}</BlobSchemaContext.Provider>
}

const EMPTY_WARNINGS: SchemaWarning[] = []

/** Resolved subschema at a value path; undefined without a provider/schema. */
export function useSubschema(path: ValuePath): BlobSchema | 'unresolved' | undefined {
  const ctx = useContext(BlobSchemaContext)
  if (!ctx) return undefined
  return resolveSubschema(ctx.rootSchema, path, ctx.registry)
}

/** Advisory warnings for the node at a value path (empty when conforming). */
export function useSchemaWarnings(path: ValuePath): SchemaWarning[] {
  const ctx = useContext(BlobSchemaContext)
  if (!ctx) return EMPTY_WARNINGS
  return ctx.warningsByPath.get(warningKey(path)) ?? EMPTY_WARNINGS
}

/** The attached root schema + registry, or null when editing schemaless. */
export function useBlobSchema(): {rootSchema: BlobSchema; registry: SchemaRegistry} | null {
  return useContext(BlobSchemaContext)
}

/** Total warning count, for a summary banner. */
export function useSchemaWarningCount(): number {
  const ctx = useContext(BlobSchemaContext)
  if (!ctx) return 0
  let count = 0
  ctx.warningsByPath.forEach((warnings) => {
    count += warnings.length
  })
  return count
}
