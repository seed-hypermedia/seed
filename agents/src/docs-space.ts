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
