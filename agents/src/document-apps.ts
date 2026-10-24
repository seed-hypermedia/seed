import type {IpfsDirectoryFile} from '@seed-hypermedia/client'
import * as memory from '@/agent-memory'
import * as acorn from 'acorn'
import * as html from 'linkedom'
import {DOCUMENT_APP_SDK_VERSION, DOCUMENT_APP_METHODS} from '@shm/shared/document-app'

/** Most files a document app folder may hold. */
export const MAX_DOCUMENT_APP_FILES = 256
/** Most bytes a document app folder may hold in total. */
export const MAX_DOCUMENT_APP_BYTES = 16 * 1024 * 1024

/** Parse executable output without executing it, and enforce the selected runtime's asset contract. */
export function validateDocumentApp(files: IpfsDirectoryFile[], target: unknown = 'web-desktop') {
  if (target !== 'web-desktop' && target !== 'desktop') throw new Error('appTarget must be web-desktop or desktop')
  const warnings = new Set<string>()
  let scripts = 0
  const paths = new Set(files.map((file) => file.path))
  const syntax = (source: string, filename: string) => {
    try {
      acorn.parse(source, {ecmaVersion: 'latest', sourceType: 'script'})
      scripts++
    } catch (error) {
      throw new Error(
        `App script syntax error in ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.test(source))
      warnings.add('Use seed.storage for portable viewer/document state. It is saved on this device only, not synced.')
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
        throw new Error(`App ${file.path}: module scripts are unsupported; bundle as a classic script`)
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
          `App ${file.path}: ${url} is an external asset. Web apps must use self-contained HTML with inline scripts/styles and data images; use appTarget: "desktop" only for desktop-only bundles`,
        )
      const resolved = new URL(url, `https://bundle.invalid/${file.path}`)
      if (resolved.origin !== 'https://bundle.invalid' || !paths.has(decodeURIComponent(resolved.pathname.slice(1))))
        throw new Error(`App ${file.path}: unresolved bundle asset ${url}`)
    }
    const css = [...document.querySelectorAll('style, [style]')]
      .map((element) => (element.localName === 'style' ? element.textContent : element.getAttribute('style')))
      .join('\n')
    const cssUrls = [...css.matchAll(/url\(\s*([^)]+)\)/gi)].map((match) =>
      match[1]!.trim().replace(/^["']|["']$/g, ''),
    )
    if (target === 'web-desktop' && (/@import\s/i.test(css) || cssUrls.some((url) => !/^(data:|blob:|#)/i.test(url))))
      throw new Error(`App ${file.path}: CSS assets must be inlined for the web runtime`)
    if (/\bwindow\.seed\b|\bseed\./.test(source) && !document.querySelector('script[src="/.seed/client.js"]'))
      throw new Error(
        `App ${file.path}: include <script src="/.seed/client.js"></script> before app scripts for desktop SDK support`,
      )
  }
  if (target === 'desktop') warnings.add('Desktop-only bundle: this validation does not establish web compatibility.')
  return {
    syntax: 'passed' as const,
    scripts,
    target,
    runtimeTested: false,
    interactionTested: false,
    storage: 'device-only',
    sdk: {version: DOCUMENT_APP_SDK_VERSION, methods: [...DOCUMENT_APP_METHODS]},
    warnings: [...warnings],
  }
}

/**
 * Collects the files of a document app from agent memory. The path names either a folder, taken
 * whole (nested folders included, dotfiles skipped) and required to hold an `index.html` at its
 * root, or a single HTML file, which becomes the folder's `index.html`.
 */
export function collectDocumentAppFiles(
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
    if (file.encoding !== 'utf8' || !/\.html?$/i.test(root)) throw new Error('A single-file app must be an HTML file')
    const content = new TextEncoder().encode(file.content ?? '')
    if (content.byteLength > MAX_DOCUMENT_APP_BYTES)
      throw new Error(`An app may hold at most ${MAX_DOCUMENT_APP_BYTES} bytes`)
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
      if (files.length >= MAX_DOCUMENT_APP_FILES)
        throw new Error(`An app folder may hold at most ${MAX_DOCUMENT_APP_FILES} files`)
      const file = memory.readMemoryFile(stateDir, entry.path)
      const content =
        file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
      bytes += content.byteLength
      if (bytes > MAX_DOCUMENT_APP_BYTES)
        throw new Error(`An app folder may hold at most ${MAX_DOCUMENT_APP_BYTES} bytes`)
      files.push({path: entry.path.slice(prefix.length), content})
    }
  }
  walk(listing.entries)
  if (!files.some((file) => file.path === 'index.html'))
    throw new Error('An app folder needs an index.html at its root')
  return {files, bytes}
}
