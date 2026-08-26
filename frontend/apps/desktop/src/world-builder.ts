// The World Builder: scaffold a small ontology — a world with its own TYPES
// (Character, Place, Faction, Event) and one FOLDER per type — under a document.
//
// It is a demonstration of typed documents end to end:
//   - each type is a document carrying `schemaDefinition` (a schema blob whose
//     reference fields `target` the OTHER new type documents — hm:// URLs that
//     resolve once the tree is published, so a type can point at a type that
//     doesn't exist yet);
//   - each folder carries `childrenSchema` pointing at its type, so every page
//     created inside is typed by inheritance;
//   - folders render a live Query block (a table of their children);
//   - a starter page per type shows dates (date pickers), cross-links (title
//     pills) and object links (an `ipfs://` stats object) in the editor.
// Pure: `buildWorldPlan` computes blobs and documents; `publishWorld` sends them.
import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import type {HMPrepareDocumentChangeInput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {Block, DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {PublishDocumentInput} from '@shm/shared/universal-client'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {nameToUrl, ONYX_SCHEMAS, type OnyxSchema} from '@shm/ui/onyx/onyx-engine'

const DAG_CBOR_CODE = 0x71

export const WORLD_KIT_TYPES = ['character', 'place', 'faction', 'event'] as const
export type WorldKitType = (typeof WORLD_KIT_TYPES)[number]

/** Per type: the library schema it starts from, its folder, and labels. */
export const WORLD_KIT: Record<WorldKitType, {library: string; folder: string; singular: string; plural: string}> = {
  character: {library: 'example-character-doc', folder: 'characters', singular: 'Character', plural: 'Characters'},
  place: {library: 'example-place-doc', folder: 'places', singular: 'Place', plural: 'Places'},
  faction: {library: 'example-faction-doc', folder: 'factions', singular: 'Faction', plural: 'Factions'},
  event: {library: 'example-event-doc', folder: 'events', singular: 'Event', plural: 'Events'},
}

export const WORLD_GENRES = ['fantasy', 'science-fiction', 'historical', 'contemporary', 'mythic'] as const

export type WorldBlock = {
  id: string
  type: string
  text?: string
  annotations?: unknown[]
  attributes?: Record<string, unknown>
}

export type WorldDoc = {
  path: string[]
  /** Metadata values are strings (hm/ipfs references, dates, enums). */
  metadata: Record<string, string>
  blocks: WorldBlock[]
  /** What this document is, for progress reporting. */
  role: 'world' | 'type' | 'folder' | 'starter'
}

export type WorldPlan = {
  rootId: UnpackedHypermediaId
  blobs: {cid: string; data: Uint8Array}[]
  docs: WorldDoc[]
}

export type WorldSpec = {
  /** The account that owns the world (and signs). */
  uid: string
  /** The document the world is created under (its path; [] = the home doc). */
  basePath: string[]
  name: string
  /** Path segment for the world root (derived from the name by default). */
  slug?: string
  genre: (typeof WORLD_GENRES)[number]
  /** The in-world date the chronicle begins (YYYY-MM-DD). */
  epoch?: string
  tagline?: string
  types: WorldKitType[]
  /** Seed one starter page per type (default true). */
  starters?: boolean
}

/** A URL-safe path segment from a title ("The Shattered Coast" → "the-shattered-coast"). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'world'
}

/** `hm://<uid>/<path>` for a document. */
export function docUrl(uid: string, path: string[]): string {
  return hmId(uid, {path}).id
}

let blockCounter = 0
const blockId = (prefix: string) => `${prefix}-${(++blockCounter).toString(36)}`

export function paragraph(text: string): WorldBlock {
  return {id: blockId('p'), type: 'Paragraph', text, annotations: [], attributes: {}}
}

/** A live table of a folder's children. */
export function childrenQueryBlock(
  uid: string,
  path: string[],
  style: 'Table' | 'Card' | 'List' = 'Table',
): WorldBlock {
  return {
    id: blockId('q'),
    type: 'Query',
    text: '',
    annotations: [],
    attributes: {
      style,
      columnCount: 3,
      banner: false,
      query: {
        includes: [{space: uid, path: hmIdPathToEntityQueryPath(path).replace(/^\//, ''), mode: 'Children'}],
        sort: [{term: 'Title', reverse: false}],
      },
    },
  }
}

/**
 * Rewrite a kit schema's `target` references from the library's example types
 * to this world's own type documents, so Character.home points at THIS world's
 * Place type. Targets for types not included stay on the library type.
 */
export function retargetSchema(schema: OnyxSchema, typeUrls: Partial<Record<WorldKitType, string>>): OnyxSchema {
  const libraryUrlToType = new Map<string, WorldKitType>()
  for (const t of WORLD_KIT_TYPES) libraryUrlToType.set(nameToUrl(WORLD_KIT[t].library)!, t)
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'target' && typeof v === 'string') {
        const t = libraryUrlToType.get(v)
        out[k] = t && typeUrls[t] ? typeUrls[t] : v
      } else out[k] = walk(v)
    }
    return out
  }
  return walk(schema) as OnyxSchema
}

async function encodeBlob(value: unknown): Promise<{cid: string; data: Uint8Array}> {
  const data = cbor.encode(dagJsonToIpld(value) as any)
  const digest = await sha256.digest(data)
  return {cid: CID.createV1(DAG_CBOR_CODE, digest).toString(), data: new Uint8Array(data)}
}

/** Shift a YYYY-MM-DD date by whole years (for starter content). */
function shiftYears(date: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return `${String(Number(m[1]) + years).padStart(4, '0')}-${m[2]}-${m[3]}`
}

/** Compute everything the world needs: schema blobs and the document tree. */
export async function buildWorldPlan(spec: WorldSpec): Promise<WorldPlan> {
  const slug = spec.slug || slugify(spec.name)
  const root = [...spec.basePath, slug]
  const uid = spec.uid
  const types = spec.types.length ? spec.types : [...WORLD_KIT_TYPES]
  const typePath = (t: WorldKitType) => [...root, 'types', t]
  const folderPath = (t: WorldKitType) => [...root, WORLD_KIT[t].folder]
  const typeUrls: Partial<Record<WorldKitType, string>> = {}
  for (const t of types) typeUrls[t] = docUrl(uid, typePath(t))

  // 1. Schema blobs: the library kit, retargeted at this world's types.
  const blobs: WorldPlan['blobs'] = []
  const schemaCidByType: Partial<Record<WorldKitType, string>> = {}
  for (const t of types) {
    const library = ONYX_SCHEMAS[WORLD_KIT[t].library]
    if (!library) throw new Error(`Kit schema missing from the bundle: ${WORLD_KIT[t].library}`)
    const blob = await encodeBlob(retargetSchema(library, typeUrls))
    blobs.push(blob)
    schemaCidByType[t] = blob.cid
  }

  // 2. Documents.
  const docs: WorldDoc[] = []
  const epoch = spec.epoch
  const worldMeta: Record<string, string> = {
    name: spec.name,
    genre: spec.genre,
    schema: nameToUrl('example-world-doc')!,
  }
  if (spec.tagline) worldMeta.tagline = spec.tagline
  if (epoch) worldMeta.epoch = epoch
  docs.push({
    role: 'world',
    path: root,
    metadata: worldMeta,
    blocks: [
      paragraph(
        `${spec.name} is a ${spec.genre} world built with the World Builder. Its types live under "types"; ` +
          `each folder below only accepts pages of its type (childrenSchema), so every new page gets the right ` +
          `fields — dates, links to other pages, and linked objects — with validation as a guardrail.`,
      ),
      paragraph('Open a type page and press Create to add a page of that type, or add a page inside a folder.'),
      childrenQueryBlock(uid, root, 'Card'),
    ],
  })

  for (const t of types) {
    const kit = WORLD_KIT[t]
    const library = ONYX_SCHEMAS[kit.library]!
    docs.push({
      role: 'type',
      path: typePath(t),
      metadata: {
        name: kit.singular,
        summary: typeof library.description === 'string' ? library.description : `The ${kit.singular} type.`,
        schemaDefinition: `ipfs://${schemaCidByType[t]}`,
      },
      blocks: [
        paragraph(
          `This page defines the ${kit.singular} type for ${spec.name}. Every page in the "${kit.plural}" folder ` +
            `conforms to it. Press Create in the header to make a new ${kit.singular}, or open the schema to edit ` +
            `its fields — add a date, a link to another type, or an object field.`,
        ),
      ],
    })
  }

  for (const t of types) {
    const kit = WORLD_KIT[t]
    docs.push({
      role: 'folder',
      path: folderPath(t),
      metadata: {
        name: kit.plural,
        childrenSchema: typeUrls[t]!,
      },
      blocks: [
        paragraph(`All the ${kit.plural.toLowerCase()} of ${spec.name}. New pages here are typed as ${kit.singular}.`),
        childrenQueryBlock(uid, folderPath(t), 'Table'),
      ],
    })
  }

  // 3. Starter pages: one per type, cross-referencing each other.
  if (spec.starters !== false) {
    const has = (t: WorldKitType) => types.includes(t)
    const capital = [...folderPath('place'), 'the-capital']
    const founders = [...folderPath('faction'), 'the-founders']
    const wanderer = [...folderPath('character'), 'the-wanderer']
    const founding = [...folderPath('event'), 'the-founding']
    const start = epoch ?? '1000-01-01'
    if (has('place'))
      docs.push({
        role: 'starter',
        path: capital,
        metadata: {
          name: 'The Capital',
          kind: 'city',
          founded: shiftYears(start, -120),
          ...(has('faction') ? {ruler: docUrl(uid, founders)} : {}),
        },
        blocks: [
          paragraph(`The oldest city of ${spec.name}. Edit the Attributes to set its founding date and region.`),
        ],
      })
    if (has('faction'))
      docs.push({
        role: 'starter',
        path: founders,
        metadata: {
          name: 'The Founders',
          founded: shiftYears(start, -120),
          ...(has('place') ? {seat: docUrl(uid, capital)} : {}),
          ...(has('character') ? {leader: docUrl(uid, wanderer)} : {}),
        },
        blocks: [paragraph('The order that raised the Capital. Its seat and leader are links to other typed pages.')],
      })
    if (has('character'))
      docs.push({
        role: 'starter',
        path: wanderer,
        metadata: {
          name: 'The Wanderer',
          role: 'hero',
          born: shiftYears(start, -31),
          ...(has('place') ? {home: docUrl(uid, capital)} : {}),
          ...(has('faction') ? {faction: docUrl(uid, founders)} : {}),
        },
        blocks: [
          paragraph(
            'A starter character. In Attributes: "born" is a date picker, "home" and "faction" are links to typed ' +
              'pages, "stats" creates a linked object that must match the Character stats schema, and "notes" ' +
              'creates a free-form object.',
          ),
        ],
      })
    if (has('event'))
      docs.push({
        role: 'starter',
        path: founding,
        metadata: {
          name: 'The Founding',
          date: start,
          outcome: 'victory',
          ...(has('place') ? {location: docUrl(uid, capital)} : {}),
          ...(has('character') ? {protagonist: docUrl(uid, wanderer)} : {}),
          ...(has('faction') ? {faction: docUrl(uid, founders)} : {}),
        },
        blocks: [paragraph(`The day the chronicle of ${spec.name} begins.`)],
      })
  }

  return {rootId: hmId(uid, {path: root}), blobs, docs}
}

/** The document changes (metadata + blocks) for one planned document. */
export function docChanges(doc: WorldDoc): DocumentChange[] {
  const changes: DocumentChange[] = []
  for (const [key, value] of Object.entries(doc.metadata)) {
    changes.push(new DocumentChange({op: {case: 'setMetadata', value: {key, value}}}))
  }
  let left = ''
  for (const block of doc.blocks) {
    changes.push(
      new DocumentChange({op: {case: 'moveBlock', value: {blockId: block.id, parent: '', leftSibling: left}}}),
    )
    changes.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: Block.fromJson({
            id: block.id,
            type: block.type,
            text: block.text ?? '',
            annotations: (block.annotations ?? []) as any,
            attributes: (block.attributes ?? {}) as any,
          }),
        },
      }),
    )
    left = block.id
  }
  return changes
}

export type WorldPublisher = {
  publishBlobs: (blobs: {cid: string; data: Uint8Array}[]) => Promise<unknown>
  publishDocument: (input: PublishDocumentInput) => Promise<unknown>
}

/** Publish the plan: schema blobs first, then every document in order. */
export async function publishWorld(
  plan: WorldPlan,
  publisher: WorldPublisher,
  onProgress?: (done: number, total: number, doc: WorldDoc) => void,
): Promise<void> {
  if (plan.blobs.length) await publisher.publishBlobs(plan.blobs)
  const uid = plan.rootId.uid
  for (let i = 0; i < plan.docs.length; i++) {
    const doc = plan.docs[i]!
    await publisher.publishDocument({
      account: uid,
      signerAccountUid: uid,
      path: hmIdPathToEntityQueryPath(doc.path),
      changes: docChanges(doc) as unknown as HMPrepareDocumentChangeInput['changes'],
    })
    onProgress?.(i + 1, plan.docs.length, doc)
  }
}
