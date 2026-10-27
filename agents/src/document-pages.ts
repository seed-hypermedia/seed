import type {IpfsDirectoryFile} from '@seed-hypermedia/client'
import * as hm from '@seed-hypermedia/client'
import {z} from 'zod/v3'
import * as memory from '@/agent-memory'
import * as acorn from 'acorn'
import * as html from 'linkedom'
import {DOCUMENT_PAGE_SDK_VERSION, DOCUMENT_PAGE_METHODS} from '@shm/shared/document-page'

/** Most files a document page folder may hold. */
export const MAX_DOCUMENT_PAGE_FILES = 256
/** Most bytes a document page folder may hold in total (1 GiB). */
export const MAX_DOCUMENT_PAGE_BYTES = 1024 * 1024 * 1024

/** Parse executable output without executing it, and enforce the selected runtime's asset contract. */
export function validateDocumentPage(files: IpfsDirectoryFile[], target: unknown = 'web-desktop') {
  if (target !== 'web-desktop' && target !== 'desktop') throw new Error('pageTarget must be web-desktop or desktop')
  const warnings = new Set<string>()
  let scripts = 0
  let writesDocuments = false
  const paths = new Set(files.map((file) => file.path))
  const syntax = (source: string, filename: string) => {
    try {
      const tree = acorn.parse(source, {ecmaVersion: 'latest', sourceType: 'script'})
      const visit = (node: unknown) => {
        if (!node || typeof node !== 'object') return
        const value = node as Record<string, any>
        if (value.type === 'CallExpression' && value.callee.type === 'MemberExpression') {
          const property = value.callee.property
          const name = value.callee.computed ? property.value : property.name
          if (name === 'publishDocument' || name === 'createDocumentBlobs') writesDocuments = true
        }
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) child.forEach(visit)
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(tree)
      scripts++
    } catch (error) {
      throw new Error(
        `Page script syntax error in ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie|\bseed\s*\.\s*storage\b/.test(source))
      warnings.add(
        'Local state is device only. Store durable page data in schema-bound Seed resources; reserve seed.storage for UI preferences or temporary unsaved drafts. Read ~/tools/write/pages. Static validation cannot verify persistence.',
      )
  }
  for (const file of files) {
    const source = new TextDecoder().decode(file.content)
    if (/\.js$/i.test(file.path)) syntax(source, file.path)
    if (!/\.html?$/i.test(file.path)) continue
    const document = html.parseHTML(source).document
    let index = 0
    for (const script of document.querySelectorAll('script')) {
      const type = script.getAttribute('type')?.trim().toLowerCase() || ''
      if (type === 'module')
        throw new Error(`Page ${file.path}: module scripts are unsupported; bundle as a classic script`)
      if (
        type &&
        !['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)
      )
        continue
      const src = script.getAttribute('src')
      if (!src) syntax(script.textContent || '', `${file.path}:script-${++index}`)
    }
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('on'))
          syntax(`function handler(event) {\n${attribute.value}\n}`, `${file.path}:${attribute.name}`)
      }
    }
    for (const element of document.querySelectorAll(
      'script[src], link[href], img[src], source[src], video[src], audio[src], iframe[src], object[data], embed[src], input[src]',
    )) {
      const url = element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('data') || ''
      if (element.localName === 'script' && url === '/.seed/client.js') continue
      if (/^(data:|blob:|#)/i.test(url) && element.localName !== 'script') continue
      if (target === 'web-desktop')
        throw new Error(
          `Page ${file.path}: ${url} is an external asset. Web pages must use self-contained HTML with inline scripts/styles and data images; use pageTarget: "desktop" only for desktop-only bundles`,
        )
      const resolved = new URL(url, `https://bundle.invalid/${file.path}`)
      if (resolved.origin !== 'https://bundle.invalid' || !paths.has(decodeURIComponent(resolved.pathname.slice(1))))
        throw new Error(`Page ${file.path}: unresolved bundle asset ${url}`)
    }
    const css = [...document.querySelectorAll('style, [style]')]
      .map((element) => (element.localName === 'style' ? element.textContent : element.getAttribute('style')))
      .join('\n')
    const cssUrls = [...css.matchAll(/url\(\s*([^)]+)\)/gi)].map((match) =>
      match[1]!.trim().replace(/^["']|["']$/g, ''),
    )
    if (target === 'web-desktop' && (/@import\s/i.test(css) || cssUrls.some((url) => !/^(data:|blob:|#)/i.test(url))))
      throw new Error(`Page ${file.path}: CSS assets must be inlined for the web runtime`)
    if (/\bwindow\.seed\b|\bseed\./.test(source) && !document.querySelector('script[src="/.seed/client.js"]'))
      throw new Error(
        `Page ${file.path}: include <script src="/.seed/client.js"></script> before page scripts for desktop SDK support`,
      )
  }
  if (target === 'desktop') warnings.add('Desktop-only bundle: this validation does not establish web compatibility.')
  return {
    syntax: 'passed' as const,
    scripts,
    writesDocuments,
    target,
    runtimeTested: false,
    interactionTested: false,
    localState: 'device-only',
    dataPersistenceTested: false,
    sdk: {version: DOCUMENT_PAGE_SDK_VERSION, methods: [...DOCUMENT_PAGE_METHODS]},
    warnings: [...warnings],
  }
}

/** Check declared data collections as the agent owner, without signing or changing permissions. */
export async function checkDocumentPageData(
  client: Pick<hm.SeedClient, 'request'>,
  value: unknown,
  viewer: string,
  grantAuthorities: readonly string[] = [],
) {
  const urls = z.array(z.string().min(1)).min(1).max(16).parse(value)
  const collections = []
  const missingAccess = []
  for (const url of urls) {
    const id = hm.unpackHmId(url)
    if (!id || id.version || id.blockRef) throw new Error(`pageData needs unversioned collection HM URLs: ${url}`)
    const root = await client.request('Resource', id)
    if (root.type !== 'document') throw new Error(`Page data collection is unavailable: ${url} (${root.type})`)
    const schema = root.document.metadata.childAttributesSchema
    if (typeof schema !== 'string' || !schema)
      throw new Error(`Page data collection needs childAttributesSchema: ${url}`)
    // Probe a child path because exact-document/nonrecursive access is insufficient for Add record.
    const childPath = `${root.document.path}/_page_write_check`
    const capability = await hm.resolveCapability(client, root.id.uid, viewer, childPath)
    if (root.id.uid !== viewer && !capability) {
      const canGrant = grantAuthorities.includes(root.id.uid)
      const input = {delegate: viewer, role: 'WRITER', path: root.document.path || '/'}
      missingAccess.push({
        collection: url,
        owner: root.id.uid,
        ...input,
        canGrant,
        ...(canGrant
          ? {
              grant: {
                address: hm.packBaseId(root.id.uid),
                options: {action: 'capability.grant', signer: {publicKey: root.id.uid}, input},
                dryRun: true,
              },
            }
          : {}),
      })
    }
    collections.push({url, schema, visibility: root.document.visibility, ...(capability ? {capability} : {})})
  }
  return {
    viewer,
    collections,
    writeAccess: missingAccess.length ? ('missing' as const) : ('passed' as const),
    ...(missingAccess.length ? {missingAccess} : {}),
    dataPersistenceTested: false,
  }
}

/**
 * Collects the files of a document page from agent memory. The path names either a folder, taken
 * whole (nested folders included, dotfiles skipped) and required to hold an `index.html` at its
 * root, or a single HTML file, which becomes the folder's `index.html`.
 */
export function collectDocumentPageFiles(
  stateDir: string,
  rawPath: string,
): {files: IpfsDirectoryFile[]; bytes: number} {
  const root = rawPath.replace(/^(~\/memory\/|\/workspace\/)/, '').replace(/\/+$/, '')
  let listing: ReturnType<typeof memory.listMemoryDir> | null = null
  try {
    listing = memory.listMemoryDir(stateDir, root)
  } catch (error) {
    if (!(error instanceof memory.AgentMemoryError)) throw error
  }
  if (!listing) {
    const file = memory.readMemoryFile(stateDir, root)
    if (file.encoding !== 'utf8' || !/\.html?$/i.test(root)) throw new Error('A single-file page must be an HTML file')
    const content = new TextEncoder().encode(file.content ?? '')
    if (content.byteLength > MAX_DOCUMENT_PAGE_BYTES)
      throw new Error(`A page may hold at most ${MAX_DOCUMENT_PAGE_BYTES} bytes`)
    return {files: [{path: 'index.html', content}], bytes: content.byteLength}
  }
  const files: IpfsDirectoryFile[] = []
  let bytes = 0
  const prefix = listing.path ? `${listing.path}/` : ''
  const walk = (entries: typeof listing.entries) => {
    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
      if (name.startsWith('.')) continue
      if (entry.type === 'dir') {
        walk(memory.listMemoryDir(stateDir, entry.path).entries)
        continue
      }
      if (files.length >= MAX_DOCUMENT_PAGE_FILES)
        throw new Error(`A page folder may hold at most ${MAX_DOCUMENT_PAGE_FILES} files`)
      const file = memory.readMemoryFile(stateDir, entry.path)
      const content =
        file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
      bytes += content.byteLength
      if (bytes > MAX_DOCUMENT_PAGE_BYTES)
        throw new Error(`A page folder may hold at most ${MAX_DOCUMENT_PAGE_BYTES} bytes`)
      files.push({path: entry.path.slice(prefix.length), content})
    }
  }
  walk(listing.entries)
  if (!files.some((file) => file.path === 'index.html'))
    throw new Error('A page folder needs an index.html at its root')
  return {files, bytes}
}
