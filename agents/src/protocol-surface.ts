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
 * `agents/protocol/PROTOCOL.md`. The rules are deliberately conservative: a changed type string
 * counts as breaking even when the change might be benign, because a human deciding "this is
 * fine, bump and note it" is cheap and a crashed release is not.
 */
import ts from 'typescript'
import path from 'node:path'

/**
 * A named type on the wire: an object (field name → rendered type, the name suffixed `?` when the
 * field is optional, so a PR diff of the snapshot reads like the type itself), or anything else
 * (its rendered form).
 */
export type SurfaceShape = {fields?: Record<string, string>; alias?: string}

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
 * Aliases rendered by name and never recorded under `types`: their members are the `actions` and
 * `responses` groups themselves, and expanding them again would report every action change twice
 * (once correctly classified under `actions`, once as an opaque string change here).
 */
const GROUP_ALIASES = new Set(['UnsignedAgentAction', 'AgentAction', 'AgentResponse'])

export type ProtocolSurface = {
  protocol: number
  minClientProtocol: number
  minServerProtocol: number
  /** The signed envelope a client sends, keyed `SignedActionEnvelope`. */
  envelope: SurfaceShape
  /** Every `UnsignedAgentAction` member, keyed by its `_` discriminant. */
  actions: Record<string, SurfaceShape>
  /** Every `AgentResponse` member, keyed by its `_` discriminant. */
  responses: Record<string, SurfaceShape>
  /** Every named type the above reach, keyed by alias name. */
  types: Record<string, SurfaceShape>
}

export type SurfaceChange = {
  /** `breaking` needs a protocol bump; `compatible` does not. */
  severity: 'breaking' | 'compatible'
  /** Which side a client from the base would be hurt on. */
  direction: 'reads' | 'writes'
  /** `responses.GetAgentResponse.sessions`, `types.SessionInfo`, ... */
  path: string
  detail: string
}

const DEFAULT_ENTRY = path.resolve(import.meta.dir, '../protocol/src/index.ts')

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

  const exportedType = (name: string): ts.Type => {
    const symbol = exports.get(name)
    if (!symbol) throw new Error(`protocol does not export ${name}`)
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return checker.getDeclaredTypeOfSymbol(resolved)
  }
  const exportedConstant = (name: string): number => {
    const symbol = exports.get(name)
    if (!symbol) throw new Error(`protocol does not export ${name}`)
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const type = checker.getTypeOfSymbol(resolved)
    if (!type.isNumberLiteral()) throw new Error(`${name} must be a number literal`)
    return type.value
  }

  const types: Record<string, SurfaceShape> = {}
  const inProgress = new Set<string>()

  /** Whether a symbol is declared inside the protocol package (as opposed to the TS lib). */
  const isProtocolSymbol = (symbol: ts.Symbol | undefined): boolean =>
    !!symbol?.declarations?.some((decl) => decl.getSourceFile().fileName.startsWith(protocolDir))

  const shapeOf = (type: ts.Type): SurfaceShape => {
    if (type.isUnion() && !(type.flags & ts.TypeFlags.Boolean)) return {alias: render(type, true)}
    if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
      const fields = fieldsOf(type)
      if (fields) return {fields}
    }
    return {alias: render(type, true)}
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
    for (const prop of props.sort((a, b) => a.name.localeCompare(b.name))) {
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
      const args = type.aliasTypeArguments ?? []
      return args.length ? `${alias.name}<${args.map((arg) => render(arg)).join(', ')}>` : alias.name
    }
    if (type.flags & ts.TypeFlags.Boolean) return 'boolean'
    if (type.isUnion()) return uniqueSorted(type.types.map((member) => render(member))).join(' | ')
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
      if (symbol && isProtocolSymbol(symbol) && symbol.name !== '__type' && symbol.name !== '__object') {
        record(symbol.name, type)
        return symbol.name
      }
      if (symbol && !isProtocolSymbol(symbol) && symbol.name !== '__type' && symbol.name !== '__object') {
        // A lib object such as `Uint8Array` or `Date`: its name is its contract.
        const args = checker.getTypeArguments(type as ts.TypeReference)
        return args.length ? `${symbol.name}<${args.map((arg) => render(arg)).join(', ')}>` : symbol.name
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
    protocol: exportedConstant('AGENTS_PROTOCOL_VERSION'),
    minClientProtocol: exportedConstant('MIN_CLIENT_PROTOCOL'),
    minServerProtocol: exportedConstant('MIN_SERVER_PROTOCOL'),
    envelope,
    actions,
    responses,
    types: sortKeys(types),
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

/** Names of `types` entries reachable from a set of shapes, following rendered type strings. */
export function reachableTypes(roots: SurfaceShape[], types: Record<string, SurfaceShape>): Set<string> {
  const names = Object.keys(types)
  const seen = new Set<string>()
  const queue = [...roots]
  const mentioned = (shape: SurfaceShape): string[] => {
    const text = shape.alias ?? Object.values(shape.fields ?? {}).join(' ')
    return names.filter((name) => new RegExp(`(?<![\\w.])${name}(?![\\w])`).test(text))
  }
  while (queue.length) {
    for (const name of mentioned(queue.pop()!)) {
      if (seen.has(name)) continue
      seen.add(name)
      queue.push(types[name]!)
    }
  }
  return seen
}

/**
 * Classifies the differences between two surfaces from the point of view of a client built from
 * `base` talking to a server built from `current` — and, for what the client writes, of a server
 * built from `base` receiving a client built from `current` is *not* the concern: servers redeploy
 * first, so the question is always "does the old client survive the new server".
 */
export function diffSurfaces(base: ProtocolSurface, current: ProtocolSurface): SurfaceChange[] {
  const changes: SurfaceChange[] = []
  const readTypes = reachableTypes(Object.values(base.responses), base.types)
  const writeTypes = reachableTypes([base.envelope, ...Object.values(base.actions)], base.types)

  const compareShape = (
    pathPrefix: string,
    before: SurfaceShape,
    after: SurfaceShape,
    direction: 'reads' | 'writes',
  ) => {
    if (before.alias !== undefined || after.alias !== undefined) {
      if (before.alias !== after.alias || !!before.fields !== !!after.fields) {
        changes.push({
          severity: 'breaking',
          direction,
          path: pathPrefix,
          detail: `type changed from \`${before.alias ?? '{…}'}\` to \`${after.alias ?? '{…}'}\``,
        })
      }
      return
    }
    const beforeFields = surfaceFields(before)
    const afterFields = surfaceFields(after)
    for (const [name, field] of beforeFields) {
      const next = afterFields.get(name)
      const fieldPath = `${pathPrefix}.${name}`
      if (!next) {
        changes.push({
          severity: 'breaking',
          direction,
          path: fieldPath,
          detail:
            direction === 'reads'
              ? 'field removed; old clients still read it'
              : 'field removed; old clients still send it',
        })
        continue
      }
      if (next.type !== field.type) {
        changes.push({
          severity: 'breaking',
          direction,
          path: fieldPath,
          detail: `type changed from \`${field.type}\` to \`${next.type}\``,
        })
      }
      if (field.optional !== next.optional) {
        // Reads: a field an old client relies on may now be missing. Writes: a server may now
        // refuse an old client that omits it.
        const breaking = direction === 'reads' ? !field.optional && next.optional : field.optional && !next.optional
        changes.push({
          severity: breaking ? 'breaking' : 'compatible',
          direction,
          path: fieldPath,
          detail: next.optional ? 'became optional' : 'became required',
        })
      }
    }
    for (const [name, field] of afterFields) {
      if (beforeFields.has(name)) continue
      const breaking = direction === 'writes' && !field.optional
      changes.push({
        severity: breaking ? 'breaking' : 'compatible',
        direction,
        path: `${pathPrefix}.${name}`,
        detail: breaking ? 'required field added; old clients do not send it' : 'field added',
      })
    }
  }

  const compareGroup = (
    group: 'actions' | 'responses',
    direction: 'reads' | 'writes',
    before: Record<string, SurfaceShape>,
    after: Record<string, SurfaceShape>,
  ) => {
    for (const [name, shape] of Object.entries(before)) {
      const next = after[name]
      if (!next) {
        changes.push({
          severity: 'breaking',
          direction,
          path: `${group}.${name}`,
          detail: `${group.slice(0, -1)} removed`,
        })
        continue
      }
      compareShape(`${group}.${name}`, shape, next, direction)
    }
    for (const name of Object.keys(after)) {
      if (!(name in before)) {
        changes.push({
          severity: 'compatible',
          direction,
          path: `${group}.${name}`,
          detail: `${group.slice(0, -1)} added`,
        })
      }
    }
  }

  compareGroup('responses', 'reads', base.responses, current.responses)
  compareGroup('actions', 'writes', base.actions, current.actions)
  compareShape('envelope', base.envelope, current.envelope, 'writes')

  for (const [name, shape] of Object.entries(base.types)) {
    const directions: Array<'reads' | 'writes'> = []
    if (readTypes.has(name)) directions.push('reads')
    if (writeTypes.has(name)) directions.push('writes')
    if (directions.length === 0) continue
    const next = current.types[name]
    for (const direction of directions) {
      if (!next) {
        changes.push({severity: 'breaking', direction, path: `types.${name}`, detail: 'type no longer on the wire'})
        continue
      }
      compareShape(`types.${name}`, shape, next, direction)
    }
  }

  return dedupe(changes)
}

function dedupe(changes: SurfaceChange[]): SurfaceChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    const key = `${change.severity}|${change.direction}|${change.path}|${change.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
  if (current.minClientProtocol > current.protocol || current.minServerProtocol > current.protocol) {
    problems.push('MIN_CLIENT_PROTOCOL and MIN_SERVER_PROTOCOL cannot exceed AGENTS_PROTOCOL_VERSION')
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
