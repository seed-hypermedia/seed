/**
 * Minimal JSON Schema validator for the bounded subset the tool registry speaks
 * (`JsonSchema` in `agents/protocol/src/tool-registry.ts`): type, properties, required,
 * additionalProperties, enum, items, minLength, minimum. Sub-session `output` schemas and
 * `return_result` payloads are validated with this; errors are structured paths the model can act
 * on. Deliberately not a full draft implementation — unknown keywords are ignored.
 */
import type {JsonSchema, JsonSchemaTypeName} from '@seed-hypermedia/agents-protocol'

export type SchemaValidationError = {path: string; message: string}

export function validateJsonSchemaValue(schema: JsonSchema, value: unknown, path = '$'): SchemaValidationError[] {
  const errors: SchemaValidationError[] = []
  const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types && !types.some((type) => matchesType(type, value))) {
    errors.push({path, message: `expected ${types.join(' | ')}, got ${describeType(value)}`})
    return errors
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    errors.push({path, message: `expected one of ${JSON.stringify(schema.enum)}`})
    return errors
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({path, message: `string shorter than minLength ${schema.minLength}`})
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({path, message: `string longer than maxLength ${schema.maxLength}`})
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push({path, message: `number below minimum ${schema.minimum}`})
  }
  if (typeof value === 'number' && schema.maximum !== undefined && value > schema.maximum) {
    errors.push({path, message: `number above maximum ${schema.maximum}`})
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({path, message: `array shorter than minItems ${schema.minItems}`})
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({path, message: `array longer than maxItems ${schema.maxItems}`})
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        errors.push(...validateJsonSchemaValue(schema.items, item, `${path}[${index}]`))
      }
    }
  }
  if (isPlainObject(value)) {
    const properties = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push({path: `${path}.${key}`, message: 'required property is missing'})
    }
    for (const [key, propValue] of Object.entries(value)) {
      const propSchema = properties[key]
      if (propSchema) {
        errors.push(...validateJsonSchemaValue(propSchema, propValue, `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push({path: `${path}.${key}`, message: 'property is not allowed'})
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...validateJsonSchemaValue(schema.additionalProperties, propValue, `${path}.${key}`))
      }
    }
  }
  return errors
}

/** Rejects schemas outside the supported subset so authoring errors surface at spawn time, not delivery time. */
export function validateJsonSchemaShape(schema: unknown, path = '$'): SchemaValidationError[] {
  if (!isPlainObject(schema)) return [{path, message: 'schema must be an object'}]
  const errors: SchemaValidationError[] = []
  // Providers require function parameters to be object-rooted; a top-level array schema fails at
  // the provider with an opaque 400. Reject here instead, where the message reaches the model.
  if (path === '$' && schema.type !== undefined && schema.type !== 'object') {
    errors.push({path: '$.type', message: 'the root must be type "object" — wrap arrays/scalars in a named property'})
  }
  const known = new Set([
    'type',
    'description',
    'properties',
    'required',
    'additionalProperties',
    'enum',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'items',
    'minItems',
    'maxItems',
  ])
  for (const key of Object.keys(schema)) {
    if (!known.has(key)) errors.push({path: `${path}.${key}`, message: 'unsupported schema keyword'})
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]
  for (const type of types) {
    if (!['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].includes(type as string)) {
      errors.push({path: `${path}.type`, message: `unknown type ${JSON.stringify(type)}`})
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      errors.push({path: `${path}.properties`, message: 'properties must be an object'})
    } else {
      for (const [key, child] of Object.entries(schema.properties)) {
        errors.push(...validateJsonSchemaShape(child, `${path}.properties.${key}`))
      }
    }
  }
  if (schema.items !== undefined) errors.push(...validateJsonSchemaShape(schema.items, `${path}.items`))
  if (typeof schema.additionalProperties === 'object') {
    errors.push(...validateJsonSchemaShape(schema.additionalProperties, `${path}.additionalProperties`))
  }
  return errors
}

function matchesType(type: JsonSchemaTypeName, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
