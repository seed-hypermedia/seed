/**
 * The agents protocol's wire surface as data, and the compatibility rules over it.
 *
 * {@link extractSurface} walks the protocol package with the TypeScript compiler and writes down
 * every action a client can send, every response a server can answer, the envelope around them,
 * and every named type they reach — each as a flat map of field name → rendered type. It is what
 * `agents/protocol/surface.json` holds, and what CI diffs against the base branch.
 *
 * {@link diffSurfaces} then classifies each difference from the point of view of a client built
 * from the base: what it *reads* (responses and the types they reach) must still be there in the
 * shape it expects, and what it *writes* (actions, the envelope, and the types they reach) must
 * still be accepted. Anything else is breaking and needs a protocol version bump — see
 * `agents/protocol/PROTOCOL.md`. The rules are deliberately conservative: a changed type counts as
 * breaking even when the change might be benign, because a human deciding "this is fine, bump and
 * note it" is cheap and a crashed release is not.
 */
import ts from 'typescript'
import path from 'node:path'

/**
 * A type on the wire, in one of three forms: an object (`fields`: name → rendered type, the name
 * suffixed `?` when optional, so a snapshot diff reads like the type itself); a discriminated
 * union of objects (`variants`: discriminant value → object shape); or anything else (`alias`:
 * its rendered form).
 */
export type SurfaceShape = {fields?: Record<string, string>; variants?: Record<string, SurfaceShape>; alias?: string}

/** One field of an object type, parsed back out of {@link SurfaceShape.fields}. */
export type SurfaceField = {type: string; optional: boolean}

/** Parses a shape's fields into name → field. */
export function surfaceFields(shape: SurfaceShape): Map<string, SurfaceField> {
  const fields = new Map<string, SurfaceField>()
  for (const [key, type] of Object.entries(shape.fields ?? {})) {
    const optional = key.endsWith('?')
    fields.set(optional ? key.slice(0, -1) : key, {type, optional})
  }
  return fields
}

/**
 * Version of the snapshot layout itself. Bumped when the extractor changes what it writes (a new
 * shape form, a different rendering), so that such a change is never mistaken for a protocol
 * change: the check skips the compatibility diff when the base was written in another format.
 */
export const SURFACE_FORMAT = 1

/** The whole wire surface at one commit: what `agents/protocol/surface.json` holds. */
export type ProtocolSurface = {
  format: number
  protocol: number
  minClientProtocol: number
  /** The signed envelope a client sends. */
  envelope: SurfaceShape
  /** Every `UnsignedAgentAction` member, keyed by its `_` discriminant. */
  actions: Record<string, SurfaceShape>
  /** Every `AgentResponse` member, keyed by its `_` discriminant. */
  responses: Record<string, SurfaceShape>
  /** Every named type the above reach, keyed by alias name. */
  types: Record<string, SurfaceShape>
}

/** One classified difference between two surfaces. */
export type SurfaceChange = {
  /** `breaking` needs a protocol bump; `compatible` does not. */
  severity: 'breaking' | 'compatible'
  /** Which side a client from the base would be hurt on. */
  direction: 'reads' | 'writes'
  /** `responses.GetAgentResponse.sessions`, `types.SessionInfo`, `types.AgentTriggerSource.<schedule>.at`, ... */
  path: string
  detail: string
}

/**
 * Aliases rendered by name and never recorded under `types`: their members are the `actions` and
 * `responses` groups themselves, and expanding them again would report every action change twice
 * (once correctly classified under `actions`, once as an opaque string change here).
 */
const GROUP_ALIASES = new Set(['UnsignedAgentAction', 'AgentAction', 'AgentResponse'])

/** Keys a discriminated union may be keyed by, in order of preference. */
const DISCRIMINANTS = ['_', 'type', 'kind']

const DEFAULT_ENTRY = path.resolve(import.meta.dir, '../protocol/src/index.ts')

/** Plain code-point order: `localeCompare` depends on the ICU build and would make snapshots drift. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => byCodePoint(a, b)))
}

/** Reads the protocol package's wire surface. Slow (a full type-check of the package): call once. */
export function extractSurface(entryFile: string = DEFAULT_ENTRY): ProtocolSurface {
  const program = ts.createProgram([entryFile], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!
    throw new Error(`protocol does not type-check: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`)
  }
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entryFile)
  if (!source) throw new Error(`cannot load ${entryFile}`)
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol) throw new Error('protocol entry has no module symbol')
  const exports = new Map(checker.getExportsOfModule(moduleSymbol).map((symbol) => [symbol.name, symbol]))
  const protocolDir = path.dirname(entryFile)

  const exportedSymbol = (name: string): ts.Symbol => {
    const symbol = exports.get(name)
    if (!symbol) throw new Error(`protocol does not export ${name}`)
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  }
  const exportedType = (name: string): ts.Type => checker.getDeclaredTypeOfSymbol(exportedSymbol(name))
  const exportedConstant = (name: string): number => {
    const type = checker.getTypeOfSymbol(exportedSymbol(name))
    if (!type.isNumberLiteral()) throw new Error(`${name} must be a number literal`)
    return type.value
  }

  const types: Record<string, SurfaceShape> = {}
  const inProgress = new Set<string>()

  /** Whether a symbol is declared inside the protocol package (as opposed to the TS lib). */
  const isProtocolSymbol = (symbol: ts.Symbol | undefined): boolean =>
    !!symbol?.declarations?.some((decl) => decl.getSourceFile().fileName.startsWith(protocolDir))

  /** A checker-made synthetic symbol name (`__type`, `__object`), as opposed to something the author wrote. */
  const isSynthetic = (symbol: ts.Symbol): boolean => symbol.name.startsWith('__')

  const shapeOf = (type: ts.Type): SurfaceShape => {
    if (type.isUnion() && !(type.flags & ts.TypeFlags.Boolean)) {
      const variants = variantsOf(type)
      return variants ? {variants} : {alias: render(type, true)}
    }
    if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
      const fields = fieldsOf(type)
      if (fields) return {fields}
    }
    return {alias: render(type, true)}
  }

  /**
   * A union of objects keyed by a shared discriminant becomes one shape per member, so that an
   * optional field added to one member reads as what it is (additive) rather than as an opaque
   * change to the whole union.
   */
  const variantsOf = (type: ts.UnionType): Record<string, SurfaceShape> | undefined => {
    const members = type.types
    if (members.length < 2 || !members.every((member) => member.flags & ts.TypeFlags.Object)) return undefined
    for (const key of DISCRIMINANTS) {
      const variants: Record<string, SurfaceShape> = {}
      let ok = true
      for (const member of members) {
        const tag = checker.getPropertyOfType(member, key)
        const tagType = tag && declaredType(tag)
        const fields = tagType?.isStringLiteral() && !(tagType.value in variants) ? fieldsOf(member) : undefined
        if (!fields) {
          ok = false
          break
        }
        variants[(tagType as ts.StringLiteralType).value] = {fields}
      }
      if (ok) return sortKeys(variants)
    }
    return undefined
  }

  const fieldsOf = (type: ts.Type): Record<string, string> | undefined => {
    if (checker.isArrayType(type) || checker.isTupleType(type)) return undefined
    if (type.getCallSignatures().length > 0) return undefined
    const props = checker.getPropertiesOfType(type)
    const indexInfos = checker.getIndexInfosOfType(type)
    if (props.length === 0 && indexInfos.length === 0) return undefined
    const fields: Record<string, string> = {}
    for (const info of indexInfos) {
      fields[`[key: ${render(info.keyType)}]`] = render(info.type)
    }
    // Copied before sorting: the checker hands out its own cached member array.
    for (const prop of [...props].sort((a, b) => byCodePoint(a.name, b.name))) {
      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0
      fields[optional ? `${prop.name}?` : prop.name] = render(declaredType(prop))
    }
    return fields
  }

  /**
   * The type a property was written with. Read from its declaration rather than the checker's
   * widened property type, which for `status?: SessionStatus` would be the alias's members plus
   * `undefined` — losing the alias name that lets a change inside it show up in one place.
   */
  const declaredType = (prop: ts.Symbol): ts.Type => {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0]
    if (decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) && decl.type) {
      return checker.getTypeFromTypeNode(decl.type)
    }
    return checker.getTypeOfSymbol(prop)
  }

  /** `Name` or `Name<arg, arg>`. */
  const named = (name: string, args: readonly ts.Type[]): string =>
    args.length ? `${name}<${args.map((arg) => render(arg)).join(', ')}>` : name

  /**
   * Renders a type for the snapshot. Named protocol aliases are recorded under `types` and
   * referenced by name, so a change inside them shows up once, where it happened; everything
   * else is rendered structurally.
   */
  const render = (type: ts.Type, expandAlias = false): string => {
    const alias = type.aliasSymbol
    if (alias && !expandAlias) {
      if (GROUP_ALIASES.has(alias.name)) return alias.name
      if (isProtocolSymbol(alias)) {
        record(alias.name, type)
        return alias.name
      }
      // A lib alias such as `Record<string, X>` or `Partial<X>`: keep the name, render the args.
      return named(alias.name, type.aliasTypeArguments ?? [])
    }
    if (type.flags & ts.TypeFlags.Boolean) return 'boolean'
    if (type.isUnion()) return [...new Set(type.types.map((member) => render(member)))].sort(byCodePoint).join(' | ')
    if (type.isIntersection()) {
      const fields = fieldsOf(type)
      return fields ? renderFields(fields) : type.types.map((member) => render(member)).join(' & ')
    }
    if (checker.isTupleType(type)) {
      const elements = checker.getTypeArguments(type as ts.TypeReference)
      return `[${elements.map((element) => render(element)).join(', ')}]`
    }
    if (checker.isArrayType(type)) {
      const [element] = checker.getTypeArguments(type as ts.TypeReference)
      return `${element ? renderAtom(element) : 'unknown'}[]`
    }
    if (type.flags & ts.TypeFlags.Object) {
      if (type.getCallSignatures().length > 0) return 'function'
      const symbol = type.getSymbol()
      if (symbol && !isSynthetic(symbol)) {
        if (isProtocolSymbol(symbol)) {
          record(symbol.name, type)
          return symbol.name
        }
        // A lib object such as `Uint8Array` or `Date`: its name is its contract.
        return named(symbol.name, checker.getTypeArguments(type as ts.TypeReference))
      }
      const fields = fieldsOf(type)
      return fields ? renderFields(fields) : '{}'
    }
    return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
  }

  const renderAtom = (type: ts.Type): string => {
    const rendered = render(type)
    return rendered.includes(' | ') || rendered.includes(' & ') ? `(${rendered})` : rendered
  }

  const renderFields = (fields: Record<string, string>): string =>
    `{${Object.entries(fields)
      .map(([name, type]) => `${name}: ${type}`)
      .join('; ')}}`

  const record = (name: string, type: ts.Type): void => {
    if (name in types || inProgress.has(name)) return
    inProgress.add(name)
    types[name] = shapeOf(type)
    inProgress.delete(name)
  }

  const discriminatedMembers = (type: ts.Type, of: string): Record<string, SurfaceShape> => {
    const members = type.isUnion() ? type.types : [type]
    const out: Record<string, SurfaceShape> = {}
    for (const member of members) {
      const tag = checker.getPropertyOfType(member, '_')
      const tagType = tag && checker.getTypeOfSymbol(tag)
      const name = tagType?.isStringLiteral() ? tagType.value : member.aliasSymbol?.name ?? member.symbol?.name
      if (!name) throw new Error(`a member of ${of} has neither a \`_\` tag nor a name`)
      if (name in out) throw new Error(`${of} names ${name} twice`)
      const fields = fieldsOf(member)
      if (!fields) throw new Error(`${of} member ${name} is not an object type`)
      out[name] = {fields}
    }
    return sortKeys(out)
  }

  const actions = discriminatedMembers(exportedType('UnsignedAgentAction'), 'UnsignedAgentAction')
  const responses = discriminatedMembers(exportedType('AgentResponse'), 'AgentResponse')
  const envelope = shapeOf(exportedType('SignedActionEnvelope'))

  return {
    format: SURFACE_FORMAT,
    protocol: exportedConstant('AGENTS_PROTOCOL_VERSION'),
    minClientProtocol: exportedConstant('MIN_CLIENT_PROTOCOL'),
    envelope,
    actions,
    responses,
    types: sortKeys(types),
  }
}

/** Every identifier-looking token in a shape's rendered types, recursively. */
function mentionedNames(shape: SurfaceShape, into: Set<string>): Set<string> {
  const texts = shape.alias !== undefined ? [shape.alias] : Object.values(shape.fields ?? {})
  for (const text of texts) {
    for (const token of text.match(/(?<![\w.])[A-Za-z_$][\w$]*(?![\w])/g) ?? []) into.add(token)
  }
  for (const variant of Object.values(shape.variants ?? {})) mentionedNames(variant, into)
  return into
}

/** Names of `types` entries reachable from a set of shapes, following rendered type references. */
export function reachableTypes(roots: SurfaceShape[], types: Record<string, SurfaceShape>): Set<string> {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    for (const name of mentionedNames(queue.pop()!, new Set())) {
      if (seen.has(name) || !(name in types)) continue
      seen.add(name)
      queue.push(types[name]!)
    }
  }
  return seen
}

type Direction = 'reads' | 'writes'

/**
 * Classifies the differences between two surfaces from the point of view of a client built from
 * `base` talking to a server built from `current`. The other direction (a new client against an
 * old server) is not judged: servers deploy first, so the question is always "does the old client
 * survive the new server". A type reached both by what the client reads and by what it writes is
 * reported once per direction.
 */
export function diffSurfaces(base: ProtocolSurface, current: ProtocolSurface): SurfaceChange[] {
  const changes: SurfaceChange[] = []
  const readTypes = reachableTypes(Object.values(base.responses), base.types)
  const writeTypes = reachableTypes([base.envelope, ...Object.values(base.actions)], base.types)
  const push = (severity: SurfaceChange['severity'], direction: Direction, path: string, detail: string) =>
    changes.push({severity, direction, path, detail})

  const compareShape = (pathPrefix: string, before: SurfaceShape, after: SurfaceShape, direction: Direction): void => {
    const form = (shape: SurfaceShape) => (shape.fields ? 'fields' : shape.variants ? 'variants' : 'alias')
    if (form(before) !== form(after)) {
      push('breaking', direction, pathPrefix, `type changed form (${form(before)} → ${form(after)})`)
      return
    }
    if (before.alias !== undefined) {
      if (before.alias !== after.alias) {
        push('breaking', direction, pathPrefix, `type changed from \`${before.alias}\` to \`${after.alias}\``)
      }
      return
    }
    if (before.variants) {
      const afterVariants = after.variants ?? {}
      for (const [tag, shape] of Object.entries(before.variants)) {
        const next = afterVariants[tag]
        if (!next) push('breaking', direction, `${pathPrefix}.<${tag}>`, 'union member removed')
        else compareShape(`${pathPrefix}.<${tag}>`, shape, next, direction)
      }
      for (const tag of Object.keys(afterVariants)) {
        if (tag in before.variants) continue
        // A reader with an exhaustive switch does not know the new member; a writer never sends it.
        if (direction === 'reads') {
          push('breaking', direction, `${pathPrefix}.<${tag}>`, 'union member added; old clients do not know it')
        } else {
          push('compatible', direction, `${pathPrefix}.<${tag}>`, 'union member added')
        }
      }
      return
    }
    const beforeFields = surfaceFields(before)
    const afterFields = surfaceFields(after)
    for (const [name, field] of beforeFields) {
      const next = afterFields.get(name)
      const fieldPath = `${pathPrefix}.${name}`
      if (!next) {
        const who = direction === 'reads' ? 'old clients still read it' : 'old clients still send it'
        push('breaking', direction, fieldPath, `field removed; ${who}`)
        continue
      }
      if (next.type !== field.type) {
        push('breaking', direction, fieldPath, `type changed from \`${field.type}\` to \`${next.type}\``)
      }
      if (field.optional !== next.optional) {
        // Reads: a field an old client relies on may now be missing. Writes: a server may now
        // refuse an old client that omits it.
        const breaking = direction === 'reads' ? !field.optional && next.optional : field.optional && !next.optional
        push(
          breaking ? 'breaking' : 'compatible',
          direction,
          fieldPath,
          next.optional ? 'became optional' : 'became required',
        )
      }
    }
    for (const [name, field] of afterFields) {
      if (beforeFields.has(name)) continue
      if (direction === 'writes' && !field.optional) {
        push('breaking', direction, `${pathPrefix}.${name}`, 'required field added; old clients do not send it')
      } else {
        push('compatible', direction, `${pathPrefix}.${name}`, 'field added')
      }
    }
  }

  const compareGroup = (
    group: 'actions' | 'responses',
    direction: Direction,
    before: Record<string, SurfaceShape>,
    after: Record<string, SurfaceShape>,
  ) => {
    const kind = group.slice(0, -1)
    for (const [name, shape] of Object.entries(before)) {
      const next = after[name]
      if (!next) push('breaking', direction, `${group}.${name}`, `${kind} removed`)
      else compareShape(`${group}.${name}`, shape, next, direction)
    }
    for (const name of Object.keys(after)) {
      if (!(name in before)) push('compatible', direction, `${group}.${name}`, `${kind} added`)
    }
  }

  compareGroup('responses', 'reads', base.responses, current.responses)
  compareGroup('actions', 'writes', base.actions, current.actions)
  compareShape('envelope', base.envelope, current.envelope, 'writes')

  for (const [name, shape] of Object.entries(base.types)) {
    const directions: Direction[] = []
    if (readTypes.has(name)) directions.push('reads')
    if (writeTypes.has(name)) directions.push('writes')
    const next = current.types[name]
    for (const direction of directions) {
      if (!next) push('breaking', direction, `types.${name}`, 'type no longer on the wire')
      else compareShape(`types.${name}`, shape, next, direction)
    }
  }

  return changes
}

/** The outcome of {@link judgeSurfaceChange}: the classified changes and why the check fails, if it does. */
export type SurfaceVerdict = {ok: boolean; problems: string[]; changes: SurfaceChange[]}

/**
 * Applies the versioning rules to a diff: breaking changes need `protocol` to have gone up, a
 * bump needs a `## Protocol <n>` entry in the changelog, and the version never goes down.
 */
export function judgeSurfaceChange(base: ProtocolSurface, current: ProtocolSurface, changelog: string): SurfaceVerdict {
  const changes = diffSurfaces(base, current)
  const breaking = changes.filter((change) => change.severity === 'breaking')
  const problems: string[] = []
  if (current.protocol < base.protocol) {
    problems.push(`AGENTS_PROTOCOL_VERSION went down from ${base.protocol} to ${current.protocol}`)
  }
  if (current.minClientProtocol > current.protocol) {
    problems.push('MIN_CLIENT_PROTOCOL cannot exceed AGENTS_PROTOCOL_VERSION')
  }
  if (current.minClientProtocol < base.minClientProtocol) {
    problems.push(`MIN_CLIENT_PROTOCOL went down from ${base.minClientProtocol} to ${current.minClientProtocol}`)
  }
  if (breaking.length > 0 && current.protocol <= base.protocol) {
    problems.push(
      `${breaking.length} breaking protocol change${
        breaking.length === 1 ? '' : 's'
      } without bumping AGENTS_PROTOCOL_VERSION (still ${current.protocol}):\n` +
        breaking.map((change) => `  - ${change.path}: ${change.detail} [${change.direction}]`).join('\n'),
    )
  }
  if (current.protocol > base.protocol) {
    for (let version = base.protocol + 1; version <= current.protocol; version++) {
      if (!new RegExp(`^## Protocol ${version}\\b`, 'm').test(changelog)) {
        problems.push(
          `PROTOCOL.md has no "## Protocol ${version}" entry describing the change and how older clients are served`,
        )
      }
    }
  }
  return {ok: problems.length === 0, problems, changes}
}
