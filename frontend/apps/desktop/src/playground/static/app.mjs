import {createSyncView} from './sync.mjs'
import {createObjectEditor} from './editor.mjs'
import {escapeHTML, entityIcon} from './ui.mjs'

/**
 * The HM26 playground page. It renders the snapshot served by the Seed app's playground API and
 * sends every change back as an action. Authority is never evaluated here: the page shows the
 * facts the API derived.
 */
const API = '/api/playground'
const UI_KEY = 'hm26-playground-ui'
const SELECTION_TYPES = ['key', 'resource', 'grant', 'statement', 'change', 'revocation', 'policy']

let snap = null
let selection = {type: 'resource', id: 'lab'}
let view = 'blobs'
const VIEWS = ['blobs', 'authority', 'placement', 'sync']

const $ = (id) => document.getElementById(id)
const esc = escapeHTML
const state = () => snap.state
const derived = () => snap.derived
const keyOf = (id) => state().keys.find((k) => k.id === id)
const name = (id) => keyOf(id)?.name || id
const res = (id) => state().resources.find((r) => r.id === id)
const resourceName = (id) => res(id)?.name || id
const grantOf = (id) => state().grants.find((g) => g.id === id)
const statementOf = (id) => state().statements.find((v) => v.id === id)
const NO_ACCESS = {read: false, write: false, admin: false, level: 0, grants: [], public: false, sync: false}
const access = (key, resource) => derived().access[key]?.[resource] || NO_ACCESS
const grantStatus = (id) => derived().grants[id]?.status || 'invalid'
const renditionOf = (rid) => derived().resources[rid]?.rendition || {status: 'missing', text: 'No authorized Ref.'}
/** The published HM26 space: thirteen schema pages and the design notes the playground follows. */
const HM26 = 'https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26'
const SCHEMA_PAGES = {
  resource: 'resource',
  change: 'change',
  revocation: 'revocation',
  snapshot: 'resource-state',
  changes: 'resource-changes',
  'changes-snapshot': 'resource-changes-state',
  tombstone: 'resource-tombstone',
  redirect: 'resource-redirect',
  republish: 'resource-republish',
}
/** The HM26 page that defines a blob of this type. Keys and policies have notes, not schemas. */
function schemaPageOf(type, o) {
  if (type === 'grant') return o.role === 'admin' ? 'capability-admin' : 'capability-revocable'
  if (type === 'statement') return SCHEMA_PAGES[o.kind] || 'resource-state'
  if (type === 'policy') return 'authority-model'
  if (type === 'key') return 'permissions-guide'
  return SCHEMA_PAGES[type]
}
const hmLink = (page, label = 'hm26/' + page) =>
  `<a class="hm" href="${HM26}/${page}" data-hm target="_blank" rel="noreferrer">${esc(label)}</a>`
/**
 * Open a link. Inside the Seed app the page runs in a frame; the app opens Hypermedia links as
 * routes when asked. In a plain browser the link opens in a new tab.
 */
function openLink(url) {
  if (window.parent !== window) window.parent.postMessage({type: 'hm26-playground-open', url}, '*')
  else window.open(url, '_blank', 'noreferrer')
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-hm]')
  if (!a) return
  e.preventDefault()
  openLink(a.getAttribute('href'))
})
/** Why a stored blob cannot be evaluated. The API lists these by id; a clean blob has none. */
const problemsOf = (id) => derived().problems?.[id] || []
const problemBox = (id) => {
  const ps = problemsOf(id)
  if (!ps.length) return ''
  return `<div class="problems"><div class="eyebrow">Cannot be evaluated</div><ul>${ps
    .map((p) => `<li>${esc(p)}</li>`)
    .join('')}</ul></div>`
}

function toast(message, error = false) {
  $('toast').textContent = message || ''
  $('toast').classList.toggle('error', error)
  $('toast').classList.toggle('warning', !error && /cannot be evaluated/.test(message || ''))
}

// ---- API ----

async function fetchSnapshot() {
  const r = await fetch(API, {cache: 'no-store'})
  const data = await r.json()
  if (!data.ok) throw Error(data.error || 'The playground API is unavailable.')
  snap = data.snapshot
  return snap
}

/** Send one action. On success the snapshot is replaced and the page re-rendered. */
async function api(action, {quiet = false} = {}) {
  let data
  try {
    const r = await fetch(API + '/actions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(action),
    })
    data = await r.json()
  } catch (e) {
    data = {ok: false, error: 'The Seed app did not answer: ' + e.message}
  }
  if (data.ok) {
    snap = data.snapshot
    if (!quiet) afterAction(data)
  } else if (!quiet) toast(data.error, true)
  return data
}

function afterAction(data) {
  const ui = data.ui
  if (ui?.select && SELECTION_TYPES.includes(ui.select.type)) selection = {type: ui.select.type, id: ui.select.id}
  if (data.message) toast(data.message)
  render()
}

// ---- rendering ----

function render() {
  if (!snap) return
  const s = state()
  $('undo').disabled = !snap.history.canUndo
  $('redo').disabled = !snap.history.canRedo
  $('rev').textContent = 'authority revision ' + s.revision
  renderPreset()
  renderWorld()
  if (view !== 'sync') renderDetails()
  saveUI()
}

function renderPreset() {
  const current = snap.preset
  $('preset').innerHTML =
    snap.scenarios.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('') +
    (current.id ? '' : '<option value="">Imported world</option>')
  $('preset').value = current.id || ''
  const scenario = snap.scenarios.find((x) => x.id === current.id)
  $('preset-state').textContent = current.modified ? 'changed since loading' : ''
  $('preset-note').textContent = scenario?.description || 'A world loaded from a JSON export.'
}

function selectObject(type, id) {
  selection = {type, id}
  render()
}

function bindSelections(root) {
  root.querySelectorAll('[data-select]').forEach((el) => {
    el.onclick = () => {
      const [type, id] = el.dataset.select.split(':')
      selectObject(type, id)
    }
  })
}

const isSel = (type, id) => (selection.type === type && selection.id === id ? ' is-selected' : '')

function renderWorld() {
  const s = state()
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view))
  document.querySelector('.columns').classList.toggle('sync-mode', view === 'sync')
  $('sync-lab').hidden = view !== 'sync'
  $('keys').hidden = view === 'sync'
  $('resources').hidden = view === 'sync'
  document.querySelector('.inspector').hidden = view === 'sync'
  if (view === 'sync') {
    syncView.render()
    return
  }
  $('keys').innerHTML = s.keys.map((k) => keyChip(k.id)).join('')
  $('resources').innerHTML =
    view === 'authority' ? authorityHTML() : view === 'placement' ? placementHTML() : blobsHTML()
  bindSelections($('keys'))
  bindSelections($('resources'))
  const bind = (attr, fn) =>
    $('resources')
      .querySelectorAll(`[data-${attr}]`)
      .forEach((b) => (b.onclick = () => fn(b.dataset[attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())])))
  bind('add-grant', (id) => openEditor('capability', {resource: id}))
  bind('add-child', (id) => openEditor('resource', {parent: id, owner: res(id)?.owner}))
  bind('add-statement', (id) => openEditor('statement', {resource: id}))
}

const keyChip = (id, small = false) =>
  `<button class="key-chip${small ? ' small' : ''}${isSel('key', id)}" data-select="key:${esc(id)}">${entityIcon(
    'key',
  )}${esc(name(id))}</button>`

function resourceHead(r) {
  return `<button class="resource-head" data-select="resource:${esc(r.id)}">${entityIcon('resource')}<b>${esc(
    r.name,
  )}</b><code>${esc(derived().resources[r.id]?.path || r.cid)}</code><span class="muted">owner ${esc(
    name(r.owner),
  )}</span><span class="tag${r.public ? ' public' : ''}">${r.public ? 'PUBLIC' : 'PRIVATE'}</span>${
    problemsOf(r.id).length ? '<span class="tag invalid">INVALID</span>' : ''
  }</button>`
}

/** Blobs: every record on each resource, flat, with the status the API derived. */
function blobsHTML() {
  const s = state()
  const d = derived()
  const row = (type, id, label, detail, status, cls = '', dim = false) =>
    `<button class="blob-row${isSel(type, id)}${dim ? ' dim' : ''}" data-select="${type}:${esc(id)}">${entityIcon(
      type,
    )}<code>${esc(id)}</code><span>${label}${
      detail ? ` <span class="muted">${detail}</span>` : ''
    }</span><span class="status ${cls}">${esc(status)}</span></button>`
  return s.resources
    .map((r) => {
      const rows = [
        ...s.grants
          .filter((g) => g.resource === r.id)
          .map((g) => {
            const st = grantStatus(g.id)
            return row(
              'grant',
              g.id,
              `${esc(g.role)} for <b>${esc(name(g.to))}</b>`,
              `issued by ${esc(name(g.from))}${g.proof ? '' : ', root anchor'}`,
              st,
              st === 'valid' ? 'good' : st === 'revoked' ? 'bad' : 'warn',
              st !== 'valid',
            )
          }),
        ...s.revocations
          .filter((v) => v.resource === r.id)
          .map((v) =>
            row(
              'revocation',
              v.id,
              `revokes <b>${esc(v.target)}</b>`,
              `signed by ${esc(name(v.author))}`,
              d.revocations[v.id]?.valid ? 'valid' : 'invalid',
              d.revocations[v.id]?.valid ? 'good' : 'warn',
            ),
          ),
        ...s.statements
          .filter((v) => v.resource === r.id)
          .map((v) => {
            const st = d.statements[v.id]?.status || 'INELIGIBLE'
            return row(
              'statement',
              v.id,
              `${esc(v.kind)} <b>${esc(v.text ?? (v.target ? '→ ' + resourceName(v.target) : ''))}</b>`,
              `by ${esc(name(v.author))}, seq ${v.seq}`,
              st.toLowerCase(),
              st === 'SELECTED' ? 'good' : st === 'OLDER' ? '' : 'warn',
              st !== 'SELECTED',
            )
          }),
        ...s.changes
          .filter((c) => c.resource === r.id)
          .map((c) => {
            const bad = problemsOf(c.id).length > 0
            return row(
              'change',
              c.id,
              `change with ${c.ops.length} ops`,
              `by ${esc(name(c.author))}`,
              bad ? 'invalid' : 'retained',
              bad ? 'warn' : '',
              bad,
            )
          }),
      ]
      return `<section class="resource${isSel('resource', r.id)}">${resourceHead(r)}${
        rows.join('') || '<p class="empty">No blobs on this resource.</p>'
      }</section>`
    })
    .join('')
}

/**
 * Authority: one graph. Resources sit along the top, keys along the bottom, and every grant is a
 * ticket node between them: a line in from its issuer, an arrow out to its recipient, and a dotted
 * line up to the exact resource it is scoped to. A revoked grant is dashed and carries its
 * revocation. Everything is positioned here from the snapshot alone.
 */
function authorityHTML() {
  const s = state()
  const d = derived()
  const W = 960
  const PAD = 70
  const PILL = {w: 128, h: 36}
  const palette = ['#60d8df', '#c6f66b', '#efbb76', '#d29cf0', '#8fd4a8', '#f0a3c0']
  const color = Object.fromEntries(s.resources.map((r, i) => [r.id, palette[i % palette.length]]))
  const spread = (n, pad) => (i) => (n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1))
  const rx = Object.fromEntries(s.resources.map((r, i) => [r.id, spread(s.resources.length, 100)(i)]))
  const kx = Object.fromEntries(s.keys.map((k, i) => [k.id, spread(s.keys.length, PAD)(i)]))
  // One lane per resource, with sub-lanes when tickets would overlap.
  const laneTop = 120
  const laneGap = PILL.h + 22
  const pills = []
  let lane = 0
  for (const r of s.resources) {
    const grants = s.grants
      .filter((g) => g.resource === r.id)
      .map((g) => ({g, x: kx[g.to]}))
      .sort((a, b) => a.x - b.x)
    const rows = []
    for (const p of grants) {
      let row = rows.findIndex((last) => p.x - last >= PILL.w + 12)
      if (row < 0) {
        row = rows.length
        rows.push(-Infinity)
      }
      rows[row] = p.x
      pills.push({...p, y: laneTop + (lane + row) * laneGap, color: color[r.id]})
    }
    lane += Math.max(1, rows.length)
  }
  const ky = laneTop + lane * laneGap + 50
  const H = ky + 60
  const RY = 42
  const sel = (type, id) => (selection.type === type && selection.id === id ? ' is-selected' : '')
  const line = (x1, y1, x2, y2, cls, extra = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" ${extra}/>`
  let edges = ''
  let nodes = ''
  for (const {g, x, y, color: c} of pills) {
    const st = grantStatus(g.id)
    const rev = s.revocations.find((v) => v.target === g.id && d.revocations[v.id]?.valid)
    const left = x - PILL.w / 2
    const bottom = y + PILL.h / 2
    edges +=
      line(x, y - PILL.h / 2, rx[g.resource], RY + 18, 'edge scope', `stroke="${c}"`) +
      line(kx[g.from], ky - 24, left + 14, bottom, 'edge issue ' + st) +
      line(left + PILL.w - 14, bottom, kx[g.to], ky - 26, 'edge grant ' + st, 'marker-end="url(#arrow)"')
    nodes += `<g class="ticket-node ${st} role-${g.role}${sel('grant', g.id)}" data-select="grant:${esc(
      g.id,
    )}" transform="translate(${left},${y - PILL.h / 2})"><rect width="${PILL.w}" height="${
      PILL.h
    }" rx="6" stroke="${c}"/><text x="10" y="15" class="role">${esc(
      g.role.toUpperCase(),
    )}</text><text x="10" y="29" class="sub">${esc(g.id)} · ${st}${!g.proof && st === 'valid' ? ' · root' : ''}</text>${
      problemsOf(g.id).length ? `<title>${esc(problemsOf(g.id)[0])}</title>` : ''
    }</g>`
    if (rev)
      nodes += `<g class="rev-node${sel('revocation', rev.id)}" data-select="revocation:${esc(
        rev.id,
      )}" transform="translate(${left + PILL.w - 6},${
        y - PILL.h / 2 - 6
      })"><circle r="9"/><text y="4" text-anchor="middle">×</text><title>${esc(rev.id)} revokes ${esc(
        g.id,
      )}</title></g>`
  }
  const resourceNodes = s.resources
    .map(
      (r) =>
        `<g class="resource-node${sel('resource', r.id)}${
          problemsOf(r.id).length ? ' invalid' : ''
        }" data-select="resource:${esc(r.id)}" transform="translate(${rx[r.id] - 80},${
          RY - 20
        })"><rect width="160" height="40" rx="6" stroke="${color[r.id]}"/><text x="12" y="17" class="name">${esc(
          r.name,
        )}</text><text x="12" y="31" class="sub">${esc(d.resources[r.id]?.path || r.cid)} · ${
          r.public ? 'public' : 'private'
        }</text>${
          problemsOf(r.id).length
            ? `<g class="bad-badge" transform="translate(154,-6)"><circle r="9"/><text y="4" text-anchor="middle">!</text><title>${esc(
                problemsOf(r.id)[0],
              )}</title></g>`
            : ''
        }</g>`,
    )
    .join('')
  const keyNodes = s.keys
    .map(
      (k) =>
        `<g class="key-node${sel('key', k.id)}" data-select="key:${esc(k.id)}" transform="translate(${
          kx[k.id]
        },${ky})"><circle r="18"/><g class="glyph" transform="translate(-9,-9) scale(0.75)"><circle cx="9" cy="9" r="5"/><path d="m12.5 12.5 8 8m-3-3 3-3m-6 0 3-3"/></g><text y="38" text-anchor="middle" class="name">${esc(
          k.name,
        )}</text></g>`,
    )
    .join('')
  const scope = selection.type === 'resource' ? selection.id : selectedRecord()?.resource || s.resources[0].id
  return `<div class="graph-wrap"><svg viewBox="0 0 ${W} ${H}" class="authority-graph" role="img" aria-label="Authority graph"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>${edges}${resourceNodes}${nodes}${keyNodes}</svg></div><div class="zone-foot"><button data-add-grant="${esc(
    scope,
  )}">+ Grant on ${esc(
    resourceName(scope),
  )}</button><span class="muted">Dotted lines are scope: a grant covers one exact resource. Solid lines run from the issuer through the grant to the recipient.</span></div>`
}

/** Placement: the folder tree. Nesting is placement only and grants nothing. */
function placementHTML() {
  const s = state()
  const d = derived()
  const node = (r) => {
    const sel = d.resources[r.id]?.selected
    const v = sel ? statementOf(sel) : null
    const children = s.resources.filter((c) => c.parent === r.id)
    const bad = problemsOf(r.id).length > 0
    return `<div class="branch"><div class="tree-node${isSel('resource', r.id)}${
      bad ? ' invalid' : ''
    }"><button class="tree-main" data-select="resource:${esc(r.id)}">${entityIcon('resource')}<b>${esc(
      r.name,
    )}</b><code>${r.segment ? esc(r.segment) : 'no name, by CID'}</code></button><span class="muted">owner ${esc(
      name(r.owner),
    )} · ${r.public ? 'public' : 'private'}</span>${bad ? '<span class="bad">invalid placement</span>' : ''}${
      v
        ? `<button class="inline" data-select="statement:${esc(v.id)}">${esc(v.id)}: ${esc(v.kind)} ${esc(
            v.text ?? '',
          )}</button>`
        : '<span class="warn">no authorized Ref</span>'
    }<span class="tree-actions"><button class="inline" data-add-child="${esc(
      r.id,
    )}">+ Child</button><button class="inline" data-add-statement="${esc(r.id)}">+ Ref</button></span></div>${
      children.length ? `<div class="children">${children.map(node).join('')}</div>` : ''
    }</div>`
  }
  const roots = s.resources.filter((r) => !r.parent || !res(r.parent))
  return `<div class="tree">${roots
    .map(node)
    .join(
      '',
    )}</div><p class="empty">Edit a resource to move it under another parent or rename its path segment. A grant on a parent never reaches a child.</p>`
}

const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`
const link = (type, id, label) => `<button class="inline" data-select="${type}:${esc(id)}">${esc(label)}</button>`

function selectedRecord() {
  const s = state()
  const {type, id} = selection
  if (type === 'resource') return res(id)
  if (type === 'key') return keyOf(id)
  if (type === 'grant') return grantOf(id)
  if (type === 'statement') return statementOf(id)
  if (type === 'change') return s.changes.find((v) => v.id === id)
  if (type === 'revocation') return s.revocations.find((v) => v.id === id)
  if (type === 'policy') return res(id.replace(/^policy-/, ''))
  return null
}

/** The read, write, admin table: every key on one resource, or one key on every resource. */
function accessTable(resource, key = null) {
  const s = state()
  const rs = key ? s.resources : [res(resource)].filter(Boolean)
  return `<div class="access"><div class="eyebrow">Access ${
    key ? 'of this key' : 'on this resource'
  }</div><table><thead><tr><th>${
    key ? 'Resource' : 'Key'
  }</th><th>Read</th><th>Write</th><th>Admin</th></tr></thead><tbody>${rs
    .flatMap((r) =>
      (key ? [keyOf(key)] : s.keys).map((k) => {
        const a = access(k.id, r.id)
        return `<tr data-permission="${esc(k.id)}:${esc(r.id)}"><td>${esc(key ? r.name : k.name)}</td>${[
          a.read,
          a.write,
          a.admin,
        ]
          .map((yes) => `<td class="${yes ? 'yes' : 'no'}">${yes ? 'yes' : 'no'}</td>`)
          .join('')}</tr>`
      }),
    )
    .join('')}</tbody></table><div id="proof" class="muted">Select a row to see which grants explain it.</div></div>`
}

function renderDetails() {
  const o = selectedRecord()
  if (!o) {
    selection = {type: 'resource', id: state().resources[0].id}
    return renderDetails()
  }
  const {type, id} = selection
  let html = ''
  let scope = o.resource
  const fields = (obj) =>
    `<details><summary>Blob fields</summary><pre>${esc(JSON.stringify(obj, null, 2))}</pre></details>`
  if (type === 'resource') {
    scope = id
    const r = renditionOf(id)
    const v = derived().resources[id]?.selected
    html = `<div class="eyebrow">Resource</div><h3>${esc(o.name)}</h3>${problemBox(id)}${kv(
      'Owner',
      link('key', o.owner, name(o.owner)),
    )}${kv('Path', esc(derived().resources[id]?.path || ''))}${kv(
      'Parent',
      o.parent ? link('resource', o.parent, resourceName(o.parent)) : 'none',
    )}${kv('Audience', `${o.public ? 'public' : 'private'} ${link('policy', 'policy-' + id, 'policy')}`)}${kv(
      'Schema',
      hmLink(schemaPageOf('resource', o)),
    )}${kv('Selected', v ? link('statement', v, v) : 'no authorized Ref')}<p class="${
      r.status === 'tombstone' ? 'warn' : ''
    }">${esc(
      r.text,
    )}</p><div class="detail-actions"><button id="edit-object">Edit</button><button id="new-node" class="primary">+ Ref</button><button id="delete-object" class="danger">Remove</button></div>${accessTable(
      id,
    )}${fields(o)}`
  } else if (type === 'key') {
    html = `<div class="eyebrow">Key</div><h3>${esc(o.name)}</h3><p class="muted">${esc(o.note)}</p>${kv(
      'Read more',
      hmLink('permissions-guide'),
    )}${kv(
      'Owns',
      state()
        .resources.filter((r) => r.owner === id)
        .map((r) => link('resource', r.id, r.name))
        .join(' ') || 'nothing',
    )}<div class="detail-actions"><button id="edit-object">Edit</button><button id="grant-to-key" class="primary">+ Grant</button><button id="delete-object" class="danger">Remove</button></div>${accessTable(
      null,
      id,
    )}${fields(o)}`
  } else if (type === 'grant') {
    const st = grantStatus(id)
    html = `<div class="eyebrow">Capability</div><h3>${esc(o.role)} for ${esc(name(o.to))}</h3>${problemBox(id)}${kv(
      'Issued by',
      link('key', o.from, name(o.from)),
    )}${kv('Granted to', link('key', o.to, name(o.to)))}${kv(
      'Resource',
      link('resource', scope, resourceName(scope)),
    )}${kv('Status', `<span class="${st === 'valid' ? 'good' : st === 'revoked' ? 'bad' : 'warn'}">${st}</span>`)}${kv(
      'Schema',
      hmLink(schemaPageOf('grant', o)),
    )}${kv('Proof', o.proof ? link('grant', o.proof, o.proof) : st === 'valid' ? 'none, root anchor' : 'none')}${
      o.reissuedFrom ? kv('Reissued from', link('grant', o.reissuedFrom, o.reissuedFrom)) : ''
    }<p class="muted">${
      o.role === 'admin'
        ? 'Admin grants are permanent. Reissuing adds a second grant and leaves this one intact.'
        : 'A grant never changes. Reissue it to add a new route, or add a revocation to end this one.'
    }</p><div class="detail-actions"><button id="edit-object">Reissue</button>${
      o.role === 'admin' ? '' : '<button id="revoke-object" class="primary">Revoke</button>'
    }</div>${fields(o)}`
  } else if (type === 'policy') {
    scope = o.id
    html = `<div class="eyebrow">Resource policy</div><h3>${esc(o.name)}</h3>${kv(
      'Signed by',
      link('key', o.owner, name(o.owner)),
    )}${kv(
      'Audience',
      o.public ? 'public' : 'private',
    )}<p class="muted">The one new signed fact HM26 proposes: who the root of a resource is and whether it is public. <a href="https://hyper.media/protocol/hm26-authority#b4HgY4uP" data-hm target="_blank" rel="noreferrer">What a resource policy is</a>. Proposed in ${hmLink(
      'authority-model',
    )}, not a published schema.</p><div class="detail-actions"><button id="edit-object">Edit</button></div>`
  } else {
    const isNode = type === 'statement'
    const status = isNode
      ? (derived().statements[id]?.status || 'INELIGIBLE').toLowerCase()
      : type === 'revocation'
        ? derived().revocations[id]?.valid
          ? 'valid'
          : 'invalid'
        : 'retained'
    html = `<div class="eyebrow">${esc(isNode ? 'Ref' : type)}</div><h3>${esc(
      isNode ? o.kind + (o.text ? ': ' + o.text : '') : type === 'revocation' ? 'revokes ' + o.target : id,
    )}</h3>${problemBox(id)}${kv('Signed by', link('key', o.author, name(o.author)))}${kv(
      'Resource',
      link('resource', scope, resourceName(scope)),
    )}${
      type === 'revocation'
        ? kv('Target', link('grant', o.target, o.target)) +
          kv('Proof', o.proof ? link('grant', o.proof, o.proof) : 'none')
        : ''
    }${
      isNode && o.target
        ? kv('Redirects to', res(o.target) ? link('resource', o.target, resourceName(o.target)) : esc(o.target))
        : ''
    }${kv(
      'Status',
      `<span class="${['selected', 'valid'].includes(status) ? 'good' : status === 'older' ? '' : 'warn'}">${esc(
        status,
      )}</span>`,
    )}${kv('Schema', hmLink(schemaPageOf(type, o)))}${
      isNode
        ? `<p class="muted">${esc(
            status === 'selected'
              ? 'This is the Ref the resource shows: the highest sequence from a key that can write right now.'
              : status === 'older'
                ? 'Retained. A newer authorized Ref is selected.'
                : 'Retained but not eligible: its author cannot write the resource right now.',
          )}</p>`
        : ''
    }<div class="detail-actions"><button id="edit-object">Edit</button><button id="delete-object" class="danger">Remove</button></div>${fields(
      o,
    )}`
  }
  $('details').innerHTML = html
  bindSelections($('details'))
  $('edit-object').onclick = () => openEditor(type, o)
  if ($('delete-object')) $('delete-object').onclick = () => api({type: 'remove', objectType: type, id})
  if ($('new-node')) $('new-node').onclick = () => openEditor('statement', {resource: id})
  if ($('grant-to-key')) $('grant-to-key').onclick = () => openEditor('capability', {to: id})
  if ($('revoke-object')) $('revoke-object').onclick = () => openEditor('revocation', {target: id, resource: scope})
  $('details')
    .querySelectorAll('[data-permission]')
    .forEach((el) => {
      el.onclick = () => {
        const [k, r] = el.dataset.permission.split(':')
        const a = access(k, r)
        $('proof').innerHTML =
          `<b>${esc(name(k))} on ${esc(resourceName(r))}</b>: ` +
          (a.grants.length
            ? a.grants.map((gid) => `${link('grant', gid, gid)} (${esc(grantOf(gid)?.role)})`).join(' ')
            : a.public
              ? 'public resource policy, read only'
              : 'no valid grant on this exact resource')
        bindSelections($('proof'))
      }
    })
}

// ---- controls ----

document.querySelectorAll('[data-view]').forEach((b) => {
  b.onclick = () => {
    view = b.dataset.view
    render()
  }
})
$('preset').onchange = () => {
  const id = $('preset').value
  if (id) api({type: 'loadScenario', id})
}
$('undo').onclick = () => api({type: 'undo'})
$('redo').onclick = () => api({type: 'redo'})
$('export').onclick = () => {
  const a = document.createElement('a')
  a.href = API + '/export'
  a.download = 'hm26-playground.json'
  a.click()
}
$('import').onclick = () => $('import-file').click()
$('import-file').onchange = async () => {
  const file = $('import-file').files?.[0]
  $('import-file').value = ''
  if (!file) return
  let parsed
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    return toast('That file is not JSON.', true)
  }
  await api({type: 'import', state: parsed?.state ?? parsed})
}

// ---- editor ----

const objectEditor = createObjectEditor({
  snapshot: () => snap,
  scope: () => (selection.type === 'resource' ? selection.id : selectedRecord()?.resource),
  res,
  name,
  resourceName,
  api,
  afterAction,
  schemaLink: (type, o) => hmLink(schemaPageOf(type, o)),
})
const openEditor = objectEditor.open
$('add-key').onclick = () => openEditor('key')
$('add-resource').onclick = () => openEditor('resource')
$('add-blob').onclick = () => openEditor('capability')

// ---- UI persistence (this browser only; the world lives on the node) ----

function saveUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({selection, view}))
  } catch {
    // Storage can be unavailable; the page works without it.
  }
}

function restoreUI() {
  let ui = null
  try {
    ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null')
  } catch {
    ui = null
  }
  if (!ui || typeof ui !== 'object') return
  if (ui.selection && SELECTION_TYPES.includes(ui.selection.type) && typeof ui.selection.id === 'string')
    selection = ui.selection
  if (VIEWS.includes(ui.view)) view = ui.view
}

const syncView = createSyncView({
  root: $('sync-lab'),
  afterAction,
  toast,
  snapshot: () => snap,
  api,
  render,
  inspect: (object) => {
    view = 'blobs'
    selectObject(object.type, object.id)
  },
})

// ---- boot ----
;(async () => {
  try {
    await fetchSnapshot()
  } catch (e) {
    toast('Could not reach the playground API on this Seed node: ' + e.message, true)
    return
  }
  restoreUI()
  render()
})()
