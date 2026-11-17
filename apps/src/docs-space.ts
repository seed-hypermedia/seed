/**
 * The Hypermedia knowledge base, named `hm://hyper.media/<path>`.
 *
 * The `hypermedia/` folder of the Seed repo publishes into one space, and the repo never names that space's key.
 * Agents address it as `hm://hyper.media/...`, and this module rewrites those URLs to the configured account before
 * a read. The account comes from the `docs-account` flag (`SEED_AGENTS_DOCS_ACCOUNT`), or from the file the
 * `docs-account-file` flag names (`SEED_AGENTS_DOCS_ACCOUNT_FILE`). The file is read on every call, so the dev loop
 * can change its key without a server restart. When neither is set, the
 * URLs stay as they are and a read of them fails. Resolving the `hyper.media` domain itself waits on domain support
 * in hm:// URLs: today that domain belongs to a different site.
 */

import {readFileSync} from 'node:fs'

/** The authority the knowledge base is written under. */
export const DOCS_AUTHORITY = 'hyper.media'

const ACCOUNT_PATTERN = /^z[1-9A-HJ-NP-Za-km-z]{40,60}$/

export type DocsSpaceOptions = {
  /** The knowledge base account, set directly. */
  account?: string
  /** A file whose trimmed content is the knowledge base account. */
  accountFile?: string
}

let options: DocsSpaceOptions = {}

/** Sets where the knowledge base lives. The service calls this once at startup. */
export function configureDocsSpace(next: DocsSpaceOptions) {
  options = {account: next.account?.trim() || undefined, accountFile: next.accountFile?.trim() || undefined}
}

/** The account that `hm://hyper.media` names, or null when it cannot be determined. */
export function docsSpaceAccount(): string | null {
  if (options.account && ACCOUNT_PATTERN.test(options.account)) return options.account
  if (options.accountFile) {
    try {
      const account = readFileSync(options.accountFile, 'utf8').trim()
      if (ACCOUNT_PATTERN.test(account)) return account
    } catch {
      // No dev site yet.
    }
  }
  return null
}

const DOCS_URL = new RegExp(`^hm://${DOCS_AUTHORITY.replace('.', '\\.')}(?=$|[/?#])`)

/** True when a URL names the knowledge base by its domain. */
export function isDocsUrl(url: string): boolean {
  return DOCS_URL.test(url)
}

/**
 * Rewrites `hm://hyper.media/...` to the knowledge base account. Any other URL, or a docs URL when no account is
 * known, comes back unchanged.
 */
export function resolveDocsUrl(url: string): string {
  if (!DOCS_URL.test(url)) return url
  const account = docsSpaceAccount()
  return account ? url.replace(DOCS_URL, `hm://${account}`) : url
}

// The alias, not as the prefix of a longer domain (`hm://hyper.media.evil`).
const ALIAS = `hm://${DOCS_AUTHORITY.replace('.', '\\.')}(?![\\w-]|\\.[\\w-])`
const LINKED_DOCS_URL = new RegExp(`(\\]\\(\\s*<?|<)${ALIAS}`, 'g')
const DOCS_ROOT = new RegExp(`${ALIAS}(?!/)`, 'g')

/**
 * The address to give a model for the knowledge base: the configured account, so the links it writes open in the
 * space this server reads (a dev or staging server's docs are not the ones the `hyper.media` domain serves). The
 * alias when no account is known.
 */
export function docsSpaceUrl(): string {
  return resolveDocsUrl(`hm://${DOCS_AUTHORITY}`)
}

/**
 * Names the knowledge base by its account wherever prompt text names its root (`hm://hyper.media`, as the Agent
 * Guide does). `hm://hyper.media/<name>` is left alone: there it is a library type name.
 */
export function resolveDocsRootMentions(text: string): string {
  const account = docsSpaceAccount()
  return account ? text.replace(DOCS_ROOT, `hm://${account}`) : text
}

/**
 * Resolves the knowledge base links in markdown an agent wrote (`[text](hm://hyper.media/…)`, `<hm://hyper.media/…>`),
 * so the people reading it get links that open in the space this server reads: a client resolves the `hyper.media`
 * domain to the production docs, whichever server the agent runs on. Only link destinations change. Code and prose
 * are left alone, since `hm://hyper.media/<name>` there is a library type name.
 */
export function resolveDocsMarkdown(markdown: string): string {
  if (!markdown.includes(`hm://${DOCS_AUTHORITY}`)) return markdown
  const account = docsSpaceAccount()
  if (!account) return markdown
  let fence: string | null = null
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return line
      }
      if (marker) {
        fence = marker
        return line
      }
      return line
        .split(/(`+[^`]+`+)/)
        .map((part, index) => (index % 2 ? part : part.replace(LINKED_DOCS_URL, `$1hm://${account}`)))
        .join('')
    })
    .join('\n')
}

type LinkedBlockNode = {block: {link?: string; [key: string]: unknown}; children?: LinkedBlockNode[]}

/** Resolves every block `link` that names the knowledge base, returning new nodes. */
export function resolveDocsLinks<T extends LinkedBlockNode>(nodes: T[]): T[] {
  return nodes.map((node) => {
    const link = node.block.link
    const block = typeof link === 'string' && isDocsUrl(link) ? {...node.block, link: resolveDocsUrl(link)} : node.block
    const children = node.children ? resolveDocsLinks(node.children) : undefined
    return {...node, block, ...(children ? {children} : {})} as T
  })
}
