import {combineTransactionSteps, Extension, getChangedRanges} from '@tiptap/core'
import {Node as ProseMirrorNode} from 'prosemirror-model'
import {Plugin, PluginKey, Transaction} from 'prosemirror-state'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {BlockSchema} from '../Blocks/api/blockTypes'

/** ProseMirror plugin key for block revision invalidation. */
export const blockRevisionInvalidationPluginKey = new PluginKey('BlockRevisionInvalidationPlugin')

const IGNORED_ATTRS = new Set([
  'id',
  'revision',
  'diff',
  'textAlignment',
  'backgroundColor',
  'textColor',
  'textSize',
  'textFamily',
  'childrenType',
  'listType',
  'listLevel',
  'start',
  'columnCount',
  'colwidth',
  'colspan',
  'rowspan',
  'columnId',
])

/** Returns true when a ProseMirror node can hold a stable block/cell reference revision. */
export function isReferenceableContainerNode(node: ProseMirrorNode): boolean {
  return node.type?.name === 'blockNode' || node.type?.name === 'tableCell' || node.type?.name === 'tableHeader'
}

function getRevisionContent(node: ProseMirrorNode): ProseMirrorNode | null {
  if (node.type?.name === 'tableCell' || node.type?.name === 'tableHeader') {
    return node.firstChild ?? null
  }

  if (node.type?.name !== 'blockNode') return null

  let content: ProseMirrorNode | null = null
  node.forEach((child) => {
    if (!content && child.type?.spec?.group === 'block') {
      content = child
    }
  })
  return content
}

function getRevisionContentPos(node: ProseMirrorNode, posBeforeNode: number): number | null {
  if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
    return node.firstChild ? posBeforeNode + 1 : null
  }

  if (node.type.name !== 'blockNode') return null

  let contentPos: number | null = null
  node.forEach((child, offset) => {
    if (contentPos === null && child.type.spec.group === 'block') {
      contentPos = posBeforeNode + offset + 1
    }
  })
  return contentPos
}

/** Returns the current referenceable revision for a block or cell container. */
export function getReferenceableRevision(node: ProseMirrorNode): string {
  const content = getRevisionContent(node)
  const revision = content?.attrs?.revision
  if (typeof revision === 'string' && revision) return revision

  const containerRevision = node.attrs?.revision
  return typeof containerRevision === 'string' ? containerRevision : ''
}

/** Returns a block's current revision by id from a ProseMirror document. */
export function getReferenceableRevisionByBlockId(doc: ProseMirrorNode | undefined, blockId: string): string {
  if (!doc || !blockId) return ''

  let revision = ''
  doc.descendants((node) => {
    if (node.type.name !== 'blockNode' || node.attrs?.id !== blockId) return true
    revision = getReferenceableRevision(node)
    return false
  })
  return revision
}

function semanticAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (IGNORED_ATTRS.has(key)) continue
    if (value === null || value === undefined || value === '') continue
    result[key] = value
  }
  return result
}

function inlineFingerprint(node: ProseMirrorNode): unknown {
  if (node.isText) {
    const linkHrefs = node.marks
      .filter((mark) => mark.type.name === 'link')
      .map((mark) => String(mark.attrs.href ?? ''))
      .sort()
    return {type: 'text', text: node.text ?? '', links: linkHrefs}
  }

  return {
    type: node.type.name,
    attrs: semanticAttrs(node.attrs),
    children: node.content.toJSON(),
  }
}

function contentFingerprint(content: ProseMirrorNode | null): string {
  if (!content) return ''

  const inline: unknown[] = []
  content.forEach((child) => {
    inline.push(inlineFingerprint(child))
  })

  return JSON.stringify({
    type: content.type.name,
    attrs: semanticAttrs(content.attrs),
    inline,
  })
}

function semanticFingerprint(node: ProseMirrorNode): string {
  const content = getRevisionContent(node)
  return JSON.stringify({
    type: node.type.name,
    attrs: node.type.name === 'blockNode' ? {} : semanticAttrs(node.attrs),
    content: contentFingerprint(content),
  })
}

function referenceableKey(node: ProseMirrorNode): string {
  const id = node.attrs?.id
  return typeof id === 'string' && id ? `${node.type.name}:${id}` : ''
}

function collectContainersInRange(doc: ProseMirrorNode, from: number, to: number): Map<number, ProseMirrorNode> {
  const result = new Map<number, ProseMirrorNode>()
  const safeFrom = Math.max(0, Math.min(from, doc.content.size))
  const safeTo = Math.max(safeFrom, Math.min(to, doc.content.size))

  doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
    if (isReferenceableContainerNode(node)) {
      result.set(pos, node)
    }
    return true
  })

  for (const pos of [safeFrom, safeTo]) {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth)
      if (isReferenceableContainerNode(node)) {
        result.set($pos.before(depth), node)
        break
      }
    }
  }

  return result
}

function clearRevision(tr: Transaction, pos: number) {
  const node = tr.doc.nodeAt(pos)
  if (!node) return

  const contentPos = getRevisionContentPos(node, pos)
  if (contentPos !== null) {
    const content = tr.doc.nodeAt(contentPos)
    if (content?.attrs?.revision && Object.prototype.hasOwnProperty.call((content.type as any).attrs, 'revision')) {
      tr.setNodeMarkup(contentPos, content.type, {...content.attrs, revision: ''}, content.marks)
    }
  }

  const current = tr.doc.nodeAt(pos)
  if (current?.attrs?.revision && Object.prototype.hasOwnProperty.call((current.type as any).attrs, 'revision')) {
    tr.setNodeMarkup(pos, current.type, {...current.attrs, revision: ''}, current.marks)
  }
}

/** Creates the ProseMirror plugin that clears stale block revisions after semantic edits. */
export function createBlockRevisionInvalidationPlugin(editor: BlockNoteEditor<BlockSchema>): Plugin {
  const publishedBaselines = new Map<string, {revision: string; fingerprint: string}>()

  return new Plugin({
    key: blockRevisionInvalidationPluginKey,
    appendTransaction(transactions, oldState, newState) {
      if ((editor as any)?._suppressChangeRef?.current) return null
      if (transactions.some((tr) => tr.getMeta(blockRevisionInvalidationPluginKey))) return null
      if (!transactions.some((tr) => tr.docChanged) || oldState.doc.eq(newState.doc)) return null

      const transform = combineTransactionSteps(oldState.doc, transactions as any)
      const changes = getChangedRanges(transform)
      const candidates = new Map<number, ProseMirrorNode>()

      for (const {newRange} of changes) {
        const from = Math.max(0, newRange.from - 1)
        const to = Math.min(newState.doc.content.size, newRange.to + 1)
        for (const [pos, node] of collectContainersInRange(newState.doc, from, to)) {
          candidates.set(pos, node)
        }
      }

      for (const transaction of transactions) {
        for (const step of transaction.steps) {
          const stepJson = step.toJSON() as {pos?: unknown; from?: unknown; to?: unknown}
          const rawFrom = typeof stepJson.pos === 'number' ? stepJson.pos : stepJson.from
          const rawTo = typeof stepJson.pos === 'number' ? stepJson.pos : stepJson.to
          if (typeof rawFrom !== 'number' && typeof rawTo !== 'number') continue
          const fromValue = typeof rawFrom === 'number' ? rawFrom : (rawTo as number)
          const toValue = typeof rawTo === 'number' ? rawTo : (rawFrom as number)
          const from = Math.min(Math.max(fromValue, 0), newState.doc.content.size)
          const to = Math.min(Math.max(toValue, 0), newState.doc.content.size)
          for (const [containerPos, node] of collectContainersInRange(newState.doc, from - 1, to + 1)) {
            candidates.set(containerPos, node)
          }
        }
      }

      if (!candidates.size) return null

      const tr = newState.tr
      const invertedMapping = transform.mapping.invert()

      for (const [pos, node] of candidates) {
        const key = referenceableKey(node)
        const revision = getReferenceableRevision(node)
        const fingerprint = semanticFingerprint(node)

        if (!revision && key) {
          const baseline = publishedBaselines.get(key)
          if (baseline && baseline.fingerprint === fingerprint) {
            const contentPos = getRevisionContentPos(node, pos)
            const content = contentPos === null ? null : tr.doc.nodeAt(contentPos)
            if (content && Object.prototype.hasOwnProperty.call((content.type as any).attrs, 'revision')) {
              tr.setNodeMarkup(
                contentPos!,
                content.type,
                {...content.attrs, revision: baseline.revision},
                content.marks,
              )
            }
          }
          continue
        }

        if (!revision) continue

        const baseline = key ? publishedBaselines.get(key) : undefined
        if (baseline && baseline.revision === revision && baseline.fingerprint === fingerprint) {
          continue
        }

        const mapped = invertedMapping.mapResult(pos)
        const oldNode = mapped.deleted ? null : oldState.doc.nodeAt(mapped.pos)
        const inserted = !oldNode || oldNode.type.name !== node.type.name
        const oldFingerprint = oldNode ? semanticFingerprint(oldNode) : ''
        const changed = inserted || oldFingerprint !== fingerprint

        if (changed) {
          if (!inserted && key && oldNode) {
            publishedBaselines.set(key, {
              revision,
              fingerprint: oldFingerprint,
            })
          }
          clearRevision(tr, pos)
        }
      }

      if (!tr.steps.length) return null
      tr.setMeta(blockRevisionInvalidationPluginKey, true)
      return tr
    },
  })
}

/** Tiptap extension that invalidates block revisions after semantic edits. */
export const BlockRevisionInvalidationExtension = Extension.create<{editor: BlockNoteEditor<BlockSchema>}>({
  name: 'BlockRevisionInvalidationExtension',
  addOptions() {
    return {editor: null as any}
  },
  addProseMirrorPlugins() {
    return [createBlockRevisionInvalidationPlugin(this.options.editor)]
  },
})
