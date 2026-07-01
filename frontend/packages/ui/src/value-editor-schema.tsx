import {Plus, TriangleAlert} from 'lucide-react'
import {instantiateSchema, resolveSubschema, type BlobSchema} from './blob-schema'
import {useBlobSchema, useSchemaWarnings} from './blob-schema-context'
import {Button} from './button'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Tooltip} from './tooltip'
import type {ValuePath} from './value-editor'

/**
 * Schema-driven affordances for the value editor. Everything here is advisory
 * and additive: without an attached schema (no BlobSchemaProvider up-tree)
 * every component renders nothing and the editor behaves exactly as before.
 */

/** Amber advisory badge listing the schema warnings for one row. */
export function SchemaWarningBadge({path}: {path: ValuePath}) {
  const warnings = useSchemaWarnings(path)
  if (warnings.length === 0) return null
  return (
    <Tooltip content={warnings.map((warning) => warning.message).join(' · ')}>
      <span className="flex shrink-0 items-center text-amber-600 dark:text-amber-500">
        <TriangleAlert className="size-3.5" />
      </span>
    </Tooltip>
  )
}

/** True when a subschema declares a usable all-string enum. */
export function isStringEnumSchema(schema: BlobSchema): schema is BlobSchema & {enum: string[]} {
  return (
    Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((option) => typeof option === 'string')
  )
}

/**
 * Select rendered in place of the free-text input when the current value is a
 * member of the schema's enum. Values outside the enum keep free text plus a
 * warning badge — never coerced.
 */
export function EnumValueSelect({
  value,
  options,
  onValue,
}: {
  value: string
  options: string[]
  onValue: (value: unknown) => void
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger className="w-fit min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The add-form types a schema node can suggest (mirrors NewFieldType values). */
export type SuggestedFieldType = 'text' | 'number' | 'toggle' | 'object' | 'list' | 'null' | 'link' | 'bytes'

/** Map a resolved subschema to the add-field form type it calls for. */
export function suggestedFieldType(schema: BlobSchema): SuggestedFieldType | null {
  if (schema.kind === 'link') return 'link'
  if (schema.kind === 'bytes') return 'bytes'
  switch (schema.type) {
    case 'string':
      return 'text'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'toggle'
    case 'object':
      return 'object'
    case 'array':
      return 'list'
    case 'null':
      return 'null'
    default:
      return null
  }
}

export type SchemaFieldSuggestion = {
  key: string
  required: boolean
  schema: BlobSchema
  type: SuggestedFieldType | null
}

/**
 * Declared-but-absent properties of the object at `path`, for key suggestions
 * and required-field chips. Empty without a schema. (A hook, not a component:
 * both AddFieldForm and ObjectEditor consume the same list differently.)
 */
export function useSchemaFieldSuggestions(path: ValuePath, existingKeys: string[]): SchemaFieldSuggestion[] {
  const ctx = useBlobSchema()
  if (!ctx) return []
  const subschema = resolveSubschema(ctx.rootSchema, path, ctx.registry)
  if (!subschema || subschema === 'unresolved' || !subschema.properties) return []
  const required = Array.isArray(subschema.required) ? subschema.required : []
  const suggestions: SchemaFieldSuggestion[] = []
  for (const key of Object.keys(subschema.properties)) {
    if (existingKeys.includes(key)) continue
    const resolved = resolveSubschema(ctx.rootSchema, [...path, key], ctx.registry)
    if (!resolved || resolved === 'unresolved') continue
    suggestions.push({
      key,
      required: required.includes(key),
      schema: resolved,
      type: suggestedFieldType(resolved),
    })
  }
  // Required fields first, then schema declaration order.
  return suggestions.sort((a, b) => Number(b.required) - Number(a.required))
}

/**
 * One-click chips adding *required* missing fields with instantiated starter
 * values. Optional declared fields live in the add form's suggestion row
 * instead, and link/bytes fields always go through the form (a placeholder
 * CID or empty binary can't be fabricated).
 */
export function SchemaFieldChips({
  path,
  existingKeys,
  onAdd,
}: {
  path: ValuePath
  existingKeys: string[]
  onAdd: (key: string, value: unknown) => void
}) {
  const ctx = useBlobSchema()
  const suggestions = useSchemaFieldSuggestions(path, existingKeys)
  if (!ctx) return null
  const addable = suggestions.filter(
    (suggestion) =>
      suggestion.required && suggestion.type !== null && suggestion.type !== 'link' && suggestion.type !== 'bytes',
  )
  if (addable.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {addable.map(({key, required, schema}) => {
        const label = required ? `${key} (required)` : key
        const chip = (
          <Button
            key={key}
            variant="outline"
            size="sm"
            className="text-muted-foreground h-6 gap-1 px-2 text-xs"
            onClick={() => onAdd(key, instantiateSchema(schema, ctx.registry))}
          >
            <Plus className="size-3" />
            {label}
          </Button>
        )
        return schema.description ? (
          <Tooltip key={key} content={schema.description} asChild>
            {chip}
          </Tooltip>
        ) : (
          chip
        )
      })}
    </div>
  )
}
