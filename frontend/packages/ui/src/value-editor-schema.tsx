import {Plus, TriangleAlert} from 'lucide-react'
import {instantiateAtPath, resolveSubschema, type BlobSchema} from './blob-schema'
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

export type LiteralOption = {label: string; value: unknown}

function literalLabel(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/**
 * The dropdown options for a literal-union subschema, or null when the enum
 * isn't dropdown-safe. Members may be mixed scalars (string/number/boolean/
 * null). Disqualifiers: non-scalar members, an empty label (Radix's
 * SelectItem throws at render for value=""), or duplicate labels (ambiguous
 * mapping + duplicate React keys) — those enums keep the free-form inputs and
 * rely on the warning badge.
 */
export function literalEnumOptions(schema: BlobSchema): LiteralOption[] | null {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null
  const options: LiteralOption[] = []
  for (const member of schema.enum) {
    const scalar =
      member === null || typeof member === 'string' || typeof member === 'number' || typeof member === 'boolean'
    if (!scalar) return null
    const label = literalLabel(member)
    if (label === '') return null
    options.push({label, value: member})
  }
  if (new Set(options.map((option) => option.label)).size !== options.length) return null
  return options
}

// Sentinel for the escape-hatch item; a NUL prefix cannot survive
// literalLabel (strings are JSON-quoted), so no member can shadow it.
const EDIT_AS_TEXT = '\u0000edit-as-text'

/**
 * Select rendered in place of the plain input when the current value is a
 * member of the schema's literal union. Options may be mixed scalars —
 * committing maps the label back to the typed literal (string/number/
 * boolean/null). Values outside the union keep the free-form input plus a
 * warning badge — never coerced. The last item is an escape hatch back to
 * free editing, so the schema never removes the ability to type.
 */
export function EnumValueSelect({
  value,
  options,
  onValue,
  onEditAsText,
}: {
  value: unknown
  options: LiteralOption[]
  onValue: (value: unknown) => void
  onEditAsText: () => void
}) {
  const current = options.find((option) => option.value === value)
  return (
    <Select
      value={current?.label ?? ''}
      onValueChange={(next) => {
        if (next === EDIT_AS_TEXT) return onEditAsText()
        const chosen = options.find((option) => option.label === next)
        if (chosen) onValue(chosen.value)
      }}
    >
      <SelectTrigger className="w-fit min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.label} value={option.label}>
            {option.label}
          </SelectItem>
        ))}
        <SelectItem value={EDIT_AS_TEXT} className="text-muted-foreground">
          Custom value…
        </SelectItem>
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
  // Literal unions route through the text form; its value input becomes a
  // dropdown of the options and the commit maps back to the typed literal.
  if (literalEnumOptions(schema)) return 'text'
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
    // "/" is reserved by DAG-JSON for link/bytes forms; never suggest
    // creating it (the add/rename forms reject it for the same reason).
    if (key === '/') continue
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
            // instantiateAtPath keeps the subschema's own pointer root so its
            // internal $refs (e.g. #/$defs/…) resolve correctly.
            onClick={() => {
              const starter = instantiateAtPath(ctx.rootSchema, [...path, key], ctx.registry)
              if (starter !== undefined) onAdd(key, starter)
            }}
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
