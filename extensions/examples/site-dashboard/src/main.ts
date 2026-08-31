/**
 * Site Dashboard — a read-only overview of the site the extension is installed on.
 *
 * Shows what the bridge's `api.query` can do without any write permission:
 * document listing (`Query`), activity (`ListEvents`), search (`Search`) and
 * account names (`Account`).
 */

import {
  applyTheme,
  connect,
  injectBaseStyles,
  type ExtensionContext,
  type HMDocumentInfo,
  type HMQueryResult,
  type HMSearchPayload,
  type SeedExtension,
} from '@seed-hypermedia/extension-sdk'
import {describeError} from './errors'
import {formatTime, shortId} from './format'
import './styles.css'

injectBaseStyles()

const app = document.getElementById('app')!

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {className?: string} = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const child of children) node.append(child)
  return node
}

// ── Data access ──

/** The shape of `ListEvents` items we rely on. The real union is wider; unknown types render generically. */
type ActivityEvent = {
  id: string
  type: string
  author?: {id?: {uid?: string}; metadata?: {name?: string}}
  time?: unknown
  // doc-update
  docId?: {id: string; path?: string[] | null}
  document?: {metadata?: {name?: string}}
  // comment
  targetMetadata?: {name?: string} | null
  comment?: {targetAccount?: string; targetPath?: string} | null
  // citation
  target?: {id?: {id?: string}; metadata?: {name?: string}}
}

type AccountResult = {type: 'account'; metadata?: {name?: string} | null} | {type: 'account-not-found'}

async function loadDocuments(seed: SeedExtension, siteUid: string): Promise<HMDocumentInfo[]> {
  const result = (await seed.query('Query', {
    includes: [{space: siteUid, mode: 'AllDescendants'}],
    sort: [{term: 'UpdateTime', reverse: true}],
  })) as HMQueryResult | null
  return result?.results ?? []
}

async function loadActivity(seed: SeedExtension, siteUid: string): Promise<ActivityEvent[]> {
  // filterResource is a glob over resource IRIs: `hm://<uid>*` matches the home document and everything beneath it.
  const result = (await seed.query('ListEvents', {pageSize: 25, filterResource: `hm://${siteUid}*`})) as {
    events: ActivityEvent[]
  }
  return result.events
}

async function loadAuthorNames(seed: SeedExtension, uids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const account = (await seed.query('Account', uid)) as AccountResult
        if (account.type === 'account' && account.metadata?.name) names.set(uid, account.metadata.name)
      } catch {
        // Unknown account: fall back to the short id.
      }
    }),
  )
  return names
}

// ── Rendering ──

function docName(doc: HMDocumentInfo): string {
  return doc.metadata?.name || (doc.path.length ? doc.path[doc.path.length - 1]! : 'Home')
}

function describeEvent(event: ActivityEvent, names: Map<string, string>): {text: string; url?: string} {
  const authorUid = event.author?.id?.uid || ''
  const author = event.author?.metadata?.name || names.get(authorUid) || shortId(authorUid) || 'Someone'
  switch (event.type) {
    case 'doc-update': {
      const name = event.document?.metadata?.name || event.docId?.path?.join('/') || 'a document'
      return {text: `${author} updated “${name}”`, url: event.docId?.id}
    }
    case 'comment': {
      const target = event.targetMetadata?.name || event.comment?.targetPath || 'a document'
      const url =
        event.comment?.targetAccount !== undefined
          ? `hm://${event.comment.targetAccount}${event.comment.targetPath || ''}`
          : undefined
      return {text: `${author} commented on “${target}”`, url}
    }
    case 'citation':
      return {text: `${author} cited “${event.target?.metadata?.name || 'a document'}”`, url: event.target?.id?.id}
    case 'capability':
      return {text: `${author} changed collaborators`}
    case 'contact':
      return {text: `${author} updated a contact`}
    default:
      return {text: `${author}: ${event.type}`}
  }
}

function render(seed: SeedExtension) {
  const siteUid = seed.context.site.uid
  const userLabel = el('span', {className: 'user'})
  const title = el('h1')
  seed.onContext((context: ExtensionContext) => {
    applyTheme(context)
    title.textContent = context.site.name ? `${context.site.name} — Dashboard` : 'Site Dashboard'
    userLabel.textContent = context.user
      ? `Signed in as ${context.user.name || context.user.accountId}`
      : 'Not signed in'
  })

  const tiles = el('div', {className: 'tiles'})
  const docsBody = el('tbody')
  const activityList = el('ul', {className: 'list'})
  const status = el('p', {className: 'muted', textContent: 'Loading…'})

  // Search
  const searchInput = el('input', {placeholder: 'Search this site…', type: 'search'})
  const searchResults = el('ul', {className: 'list'})
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  searchInput.oninput = () => {
    clearTimeout(searchTimer)
    const query = searchInput.value.trim()
    if (!query) {
      searchResults.replaceChildren()
      return
    }
    searchTimer = setTimeout(async () => {
      try {
        const result: HMSearchPayload = await seed.search(query, {accountUid: siteUid, pageSize: 10})
        searchResults.replaceChildren(
          ...result.entities.map((entity) => {
            const item = el('li', {className: 'clickable'}, [
              el('span', {}, [entity.title || entity.id.id]),
              el('span', {className: 'time', textContent: entity.type}),
            ])
            item.onclick = () => navigate(entity.id.id)
            return item
          }),
        )
        if (result.entities.length === 0) {
          searchResults.replaceChildren(el('li', {className: 'muted', textContent: 'No results'}))
        }
      } catch (error) {
        searchResults.replaceChildren(el('li', {className: 'error', textContent: describeError(error)}))
      }
    }, 300)
  }

  async function navigate(url: string) {
    try {
      await seed.navigate(url)
    } catch (error) {
      status.textContent = describeError(error)
    }
  }

  const refreshButton = el('button', {textContent: 'Refresh'})
  refreshButton.onclick = () => void load()

  async function load() {
    status.textContent = 'Loading…'
    try {
      const [docs, events] = await Promise.all([loadDocuments(seed, siteUid), loadActivity(seed, siteUid)])
      const authorUids = [...new Set(docs.flatMap((doc) => doc.authors))]
      const names = await loadAuthorNames(seed, authorUids)
      const commentTotal = docs.reduce((sum, doc) => sum + (doc.activitySummary?.commentCount ?? 0), 0)

      tiles.replaceChildren(
        tile(String(docs.length), 'Documents'),
        tile(String(commentTotal), 'Comments'),
        tile(String(authorUids.length), 'Authors'),
      )

      docsBody.replaceChildren(
        ...docs.map((doc) => {
          const row = el('tr', {className: 'doc'}, [
            el('td', {}, [docName(doc)]),
            el('td', {className: 'path', textContent: '/' + doc.path.join('/')}),
            el('td', {textContent: formatTime(doc.updateTime)}),
            el('td', {textContent: doc.authors.map((uid) => names.get(uid) || shortId(uid)).join(', ')}),
            el('td', {className: 'num', textContent: String(doc.activitySummary?.commentCount ?? 0)}),
          ])
          row.onclick = () => navigate(doc.id.id)
          return row
        }),
      )

      activityList.replaceChildren(
        ...events.map((event) => {
          const {text, url} = describeEvent(event, names)
          const item = el('li', {className: url ? 'clickable' : ''}, [
            el('span', {}, [text]),
            el('span', {className: 'time', textContent: formatTime(event.time)}),
          ])
          if (url) item.onclick = () => navigate(url)
          return item
        }),
      )
      if (events.length === 0)
        activityList.replaceChildren(el('li', {className: 'muted', textContent: 'No activity yet'}))
      status.textContent = `${docs.length} documents · updated ${new Date().toLocaleTimeString()}`
    } catch (error) {
      status.textContent = describeError(error)
      status.className = 'error'
    }
  }

  app.replaceChildren(
    el('header', {className: 'header'}, [title, userLabel]),
    el('main', {}, [
      tiles,
      el('section', {}, [el('h2', {textContent: 'Search'}), searchInput, searchResults]),
      el('section', {}, [
        el('h2', {textContent: 'Documents'}),
        el('table', {}, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', {textContent: 'Name'}),
              el('th', {textContent: 'Path'}),
              el('th', {textContent: 'Updated'}),
              el('th', {textContent: 'Authors'}),
              el('th', {className: 'num', textContent: 'Comments'}),
            ]),
          ]),
          docsBody,
        ]),
      ]),
      el('section', {}, [el('h2', {textContent: 'Recent activity'}), activityList]),
      el('div', {}, [refreshButton, ' ', status]),
    ]),
  )
  void load()
}

function tile(value: string, label: string) {
  return el('div', {className: 'tile'}, [
    el('div', {className: 'value', textContent: value}),
    el('div', {className: 'label', textContent: label}),
  ])
}

// ── Boot ──

app.replaceChildren(el('main', {}, [el('p', {className: 'muted', textContent: 'Connecting to the Seed host…'})]))

connect()
  .then(render)
  .catch((error) => {
    app.replaceChildren(
      el('main', {}, [el('p', {className: 'error', textContent: `Could not connect: ${describeError(error)}`})]),
    )
  })
