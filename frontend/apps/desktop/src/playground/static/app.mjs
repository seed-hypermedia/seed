import {createObjectEditor} from './editor.mjs'
import {topologyHTML} from './topology.mjs'
import {escapeHTML, entityIcon} from './ui.mjs'

/**
 * The HM26 playground client. It renders the snapshot served by the Seed app's playground API
 * and sends every change back as an action. Authority is never evaluated here.
 */
const API = '/api/playground'
const UI_KEY = 'hm26-playground-ui'
const RECORD_TYPES = [
  'key',
  'resource',
  'grant',
  'statement',
  'change',
  'revocation',
  'policy',
  'device',
  'offer',
  'meta',
]
const SELECTION_TYPES = ['key', 'resource', 'grant', 'statement', 'change', 'revocation', 'policy']
const CONTROL_IDS = ['issuer', 'recipient', 'scope', 'role', 'inspect-key', 'sync-key', 'sync-resource', 'edit-key']
const TABS = ['missions', 'raw', 'graph', 'inspect', 'sync', 'workflows']

let snap = null
let selection = {type: 'resource', id: 'lab'}
let view = 'authority'
let tab = 'missions'
let inspected = 'lab'
let graphScope = 'all'
let rawFocus = null
let timer = null
let ledgerQuery = ''
let ledgerType = 'all'

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
const selectedOf = (rid) => {
  const id = derived().resources[rid]?.selected
  return id ? statementOf(id) : undefined
}
const renditionOf = (rid) =>
  derived().resources[rid]?.rendition || {status: 'missing', text: 'No authorized node statement.'}
const pathOf = (rid) => derived().resources[rid]?.path || ''
const NO_ACCESS = {read: false, write: false, admin: false, level: 0, grants: [], public: false, sync: false}
const access = (k, r) => derived().access[k]?.[r] || NO_ACCESS
const grantStatus = (id) => derived().grants[id]?.status || 'invalid'
const revoked = (id) => grantStatus(id) === 'revoked'
const hostKey = () => snap.meta.hostKey

function toast(message, error = false) {
  $('toast').textContent = message || ''
  $('toast').classList.toggle('error', error)
}

// ---- API ----

async function fetchSnapshot() {
  const r = await fetch(API, {cache: 'no-store'})
  const data = await r.json()
  if (!data.ok) throw Error(data.error || 'The playground API is unavailable.')
  snap = data.snapshot
  return snap
}

/**
 * Send one action. On success the snapshot is replaced, the server's UI hints are applied and the
 * page is rendered. `quiet` leaves error handling to the caller (the editor shows it inline).
 */
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
  } else if (!quiet) {
    toast(data.error, true)
  }
  return data
}

function afterAction(data) {
  applyHint(data.ui)
  if (data.message) toast(data.message)
  render()
}

function applyHint(ui) {
  if (!ui) return
  if (ui.select && SELECTION_TYPES.includes(ui.select.type)) selection = {type: ui.select.type, id: ui.select.id}
  if (ui.view) view = ui.view
  if (ui.scope) graphScope = ui.scope
  if (ui.controls) {
    for (const [id, value] of Object.entries(ui.controls)) {
      if (id === 'inspected') inspected = value
      else pendingControls[id] = value
    }
  }
  if (ui.tab) switchTab(ui.tab, false)
}

/** Control values a hint asked for; applied once the selects have their options. */
const pendingControls = {}

// ---- rendering ----

function switchTab(t, rerender = true) {
  if (!TABS.includes(t)) return
  tab = t
  document.querySelectorAll('.tab').forEach((el) => (el.hidden = el.id !== t))
  document.querySelectorAll('nav button').forEach((el) => el.classList.toggle('active', el.dataset.tab === t))
  if (rerender) render()
}

function options(id, items, defaultValue) {
  const el = $(id)
  if (!el) return
  const old = el.value
  el.innerHTML = items.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')
  const wanted = pendingControls[id]
  delete pendingControls[id]
  el.value =
    wanted && items.some((x) => x.id === wanted)
      ? wanted
      : items.some((x) => x.id === old)
        ? old
        : items.some((x) => x.id === defaultValue)
          ? defaultValue
          : items[0]?.id
}

function render() {
  if (!snap) return
  const s = state()
  if (!res(inspected)) inspected = s.resources[0].id
  if (graphScope !== 'all' && !res(graphScope)) graphScope = 'all'
  $('undo').disabled = !snap.history.canUndo
  $('redo').disabled = !snap.history.canRedo
  $('rev').textContent = String(s.revision).padStart(3, '0')
  const st = derived().stats
  const vals = [
    [st.principals, 'PRINCIPALS', 'independent identities'],
    [st.resources, 'RESOURCES', 'exact scope only'],
    [st.activeGrants, 'ACTIVE GRANTS', 'proof-bound authority'],
    [st.revocations, 'REVOCATIONS', 'retained bytes survive'],
  ]
  $('stats').innerHTML = vals
    .map(
      ([v, l, d]) => `<div class="stat"><b>${String(v).padStart(2, '0')}</b><span>${l}<br><em>${d}</em></span></div>`,
    )
    .join('')
  for (const [id, d] of [
    ['issuer', 'alice'],
    ['recipient', 'bob'],
    ['inspect-key', 'bob'],
    ['sync-key', 'bob'],
    ['edit-key', 'carol'],
  ])
    options(id, s.keys, d)
  for (const id of ['scope', 'sync-resource']) options(id, s.resources, 'lab')
  if (pendingControls.role) {
    $('role').value = pendingControls.role
    delete pendingControls.role
  }
  drawGraph()
  renderDetails()
  renderMatrix()
  renderLedger()
  renderMissions()
  renderSync()
  saveUI()
}

function selectObject(type, id) {
  selection = {type, id}
  render()
}

function bindSelections(root) {
  root.querySelectorAll('[data-select]').forEach((el) => {
    const choose = () => {
      const [type, id] = el.dataset.select.split(':')
      selectObject(type, id)
    }
    el.onclick = choose
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        choose()
      }
    }
  })
}

function drawGraph() {
  const s = state()
  $('graph-canvas').innerHTML = topologyHTML({snapshot: snap, selection, view, scope: graphScope, rawLink})
  $('graph-note').textContent =
    view === 'authority'
      ? 'Each resource is a separate scope. Arrows read issuer → signed grant → recipient.'
      : view === 'placement'
        ? 'Folder nesting is placement only. Each child still needs its own capabilities.'
        : 'Document shapes show retained statements. Selecting a document never transfers authority.'
  for (const [id, value] of [
    ['authority-view', 'authority'],
    ['placement-view', 'placement'],
    ['blobs-view', 'blobs'],
  ])
    $(id).classList.toggle('active', view === value)
  $('world-scope').onchange = () => {
    graphScope = $('world-scope').value
    render()
  }
  $('object-picker').innerHTML = `<label>FIND ANY OBJECT<select id="pick-object" aria-label="Find any object">${[
    ...s.keys.map((k) => ({type: 'key', id: k.id, label: 'Key / ' + k.name})),
    ...s.resources.map((r) => ({type: 'resource', id: r.id, label: 'Resource / ' + r.name})),
    ...s.grants.map((g) => ({type: 'grant', id: g.id, label: 'Capability / ' + g.id + ' / ' + name(g.to)})),
    ...s.statements.map((v) => ({type: 'statement', id: v.id, label: 'Node / ' + v.id + ' / ' + v.kind})),
    ...s.changes.map((v) => ({type: 'change', id: v.id, label: 'Change / ' + v.id})),
    ...s.revocations.map((v) => ({type: 'revocation', id: v.id, label: 'Revocation / ' + v.id})),
    ...s.resources.map((r) => ({type: 'policy', id: 'policy-' + r.id, label: 'Policy / ' + r.name})),
  ]
    .map(
      (x) =>
        `<option value="${x.type}:${esc(x.id)}" ${
          selection.type === x.type && selection.id === x.id ? 'selected' : ''
        }>${esc(x.label)}</option>`,
    )
    .join('')}</select></label>`
  $('pick-object').onchange = () => {
    const [type, id] = $('pick-object').value.split(':')
    selectObject(type, id)
  }
  bindSelections($('graph-canvas'))
  bindRawLinks($('graph-canvas'))
}

const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`

function selectedRecord() {
  const s = state()
  const {type, id} = selection
  return type === 'resource'
    ? res(id)
    : type === 'key'
      ? keyOf(id)
      : type === 'grant'
        ? grantOf(id)
        : type === 'statement'
          ? statementOf(id)
          : type === 'change'
            ? s.changes.find((v) => v.id === id)
            : type === 'revocation'
              ? s.revocations.find((v) => v.id === id)
              : type === 'policy'
                ? res(id.replace(/^policy-/, ''))
                : null
}

function permissionsPanel(resource, key = null) {
  const s = state()
  const rs = key ? s.resources : [res(resource)].filter(Boolean)
  return `<div class="selection-access"><div class="eyebrow">EFFECTIVE PERMISSIONS ${
    key ? 'FOR THIS KEY' : 'ON THIS EXACT RESOURCE'
  }</div><table><thead><tr><th>${
    key ? 'RESOURCE' : 'KEY'
  }</th><th>READ</th><th>WRITE</th><th>ADMIN</th><th>SYNC</th></tr></thead><tbody>${rs
    .flatMap((r) =>
      (key ? [keyOf(key)] : s.keys).map((k) => {
        const a = access(k.id, r.id)
        return `<tr data-permission="${esc(k.id)}:${esc(r.id)}" tabindex="0"><td>${esc(key ? r.name : k.name)}</td>${[
          a.read,
          a.write,
          a.admin,
          a.sync,
        ]
          .map((yes) => `<td class="${yes ? 'yes' : 'no'}">${yes ? '✓' : '×'}</td>`)
          .join('')}</tr>`
      }),
    )
    .join(
      '',
    )}</tbody></table><small>Select a row to see the exact grant chain. Sync also requires Atlas custody and an online device.</small><div id="selection-proof"></div></div>`
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
  if (type === 'resource') {
    scope = id
    const v = selectedOf(id)
    const r = renditionOf(id)
    html = `<div class="eyebrow">RESOURCE / ${esc(o.cid)}</div><h3>${esc(
      o.name,
    )}</h3><div class="owner-badge"><span>OWNER / TRUSTED ROOT</span><button data-select="key:${esc(o.owner)}">◈ ${esc(
      name(o.owner),
    )} ↗</button></div>${kv('Placement path', esc(pathOf(id)))}${kv(
      'Optional path name',
      o.segment ? esc(o.segment) : 'Not set · use CID',
    )}${kv('Parent', o.parent ? esc(resourceName(o.parent)) : 'None / root namespace')}${kv(
      'Audience',
      o.public ? 'Public content' : 'Private',
    )}${kv(
      'Selected node',
      v
        ? `<button class="inline" data-select="statement:${esc(v.id)}">${esc(v.id)} / ${esc(v.kind)} ↗</button>`
        : 'No authorized statement',
    )}<p class="state-description ${r.status === 'tombstone' ? 'warn' : ''}">${esc(
      r.text,
    )}</p><div class="detail-actions"><button id="edit-object">Edit resource</button><button id="new-node" class="primary">+ Node version</button></div>${permissionsPanel(
      id,
    )}`
  } else if (type === 'key') {
    html = `<div class="eyebrow">SIMULATED PRINCIPAL / ${esc(id)}</div><h3>${esc(o.name)}</h3><p>${esc(o.note)}</p>${kv(
      'Owns',
      state()
        .resources.filter((r) => r.owner === id)
        .map((r) => esc(r.name))
        .join(', ') || 'No resources',
    )}${kv(
      'Valid capability routes',
      state().grants.filter((g) => g.to === id && grantStatus(g.id) === 'valid').length,
    )}<div class="detail-actions"><button id="edit-object">Edit key</button><button id="grant-to-key" class="primary">+ Grant access</button></div>${permissionsPanel(
      null,
      id,
    )}`
  } else if (type === 'grant') {
    const status = grantStatus(id)
    html = `<div class="eyebrow">CAPABILITY / ${esc(id)}</div><h3>${
      o.role === 'admin' ? 'Irrevocable admin' : esc(o.role)
    }</h3>${kv('Issued by', esc(name(o.from)))}${kv(
      'Granted to',
      `<button class="inline" data-select="key:${esc(o.to)}">${esc(name(o.to))} ↗</button>`,
    )}${kv(
      'Exact resource',
      `<button class="inline" data-select="resource:${esc(scope)}">${esc(resourceName(scope))} ↗</button>`,
    )}${kv('Resource owner', esc(name(res(scope)?.owner)))}${kv(
      'Status',
      status === 'revoked' ? 'REVOKED' : status === 'valid' ? 'VALID' : 'INVALID PROOF',
    )}${kv(
      'Permanent proof',
      o.proof
        ? `<button class="inline" data-select="grant:${esc(o.proof)}">${esc(o.proof)} ↗</button>`
        : 'Expected resource root',
    )}<div class="detail-actions"><button id="edit-object" class="primary">Reissue capability</button><button id="revoke-object">Add revocation blob</button></div><p>${
      o.role === 'admin'
        ? 'This permanent admin grant cannot be revoked. Reissuing creates a second grant; the original stays intact.'
        : 'This signed record cannot change. Reissuing adds a new route; the original remains valid until a separate authorized revocation.'
    }</p>${permissionsPanel(scope)}`
  } else if (type === 'policy') {
    scope = o.id
    html = `<div class="eyebrow">ROOT POLICY / SYNTHETIC FACT</div><h3>${esc(o.name)}</h3>${kv(
      'Owner / signer',
      esc(name(o.owner)),
    )}${kv(
      'Audience',
      o.public ? 'PUBLIC' : 'PRIVATE',
    )}<p>ResourcePolicy is a tentative separate signed fact; its runtime schema is not yet published.</p><button id="edit-object">Edit resource policy</button>${permissionsPanel(
      scope,
    )}`
  } else {
    const isNode = type === 'statement'
    const status = isNode
      ? derived().statements[id]?.status === 'SELECTED'
        ? 'SELECTED'
        : derived().statements[id]?.status === 'OLDER'
          ? 'ELIGIBLE / OLDER'
          : 'INELIGIBLE AUTHOR'
      : type === 'revocation'
        ? derived().revocations[id]?.valid
          ? 'VALID'
          : 'INVALID REVOKE'
        : 'ASSOCIATED CHANGE'
    const r = res(scope)
    html = `<div class="eyebrow">${esc(type.toUpperCase())} / ${esc(id)}</div><h3>${esc(o.kind || type)}</h3>${kv(
      'Signed by',
      esc(name(o.author)),
    )}${kv(
      'Resource',
      `<button class="inline" data-select="resource:${esc(scope)}">${esc(resourceName(scope))} ↗</button>`,
    )}${kv('Owner / root', esc(name(r?.owner)))}${kv(
      'Status',
      status,
    )}<div class="detail-actions"><button id="edit-object">Edit blob</button>${
      isNode && o.kind === 'redirect' ? '<button id="inspect-target">Inspect redirect target →</button>' : ''
    }</div>${
      isNode
        ? `<p>${esc(
            derived().resources[scope]?.selected === id
              ? renditionOf(scope).text
              : 'Retained statement. Only the highest authorized sequence is selected in this simulator.',
          )}</p>`
        : ''
    }<details><summary>Inspect blob fields</summary><pre class="code">${esc(
      JSON.stringify(
        isNode && r
          ? {
              ...o,
              node: r.cid,
              ...(r.parent ? {parent: {space: r.owner, node: res(r.parent)?.cid}} : {}),
              ...(r.segment ? {name: r.segment} : {}),
            }
          : o,
        null,
        2,
      ),
    )}</pre></details>${permissionsPanel(scope)}`
  }
  html += `<div class="inspector-raw">${rawLink(type, id, 'Open raw record in ledger')}</div>`
  if (type !== 'grant')
    html += `<div class="object-management"><button id="duplicate-object">Duplicate ${
      type === 'resource' ? 'resource' : 'object'
    }</button><button id="delete-object" class="danger">Remove from experiment</button></div><small class="fixture-note">Editing and removing modify this simulated fixture. They do not represent revoking permanent rights on a real network. Undo is always available.</small>`
  $('details').innerHTML = `<div class="detail-content">${html}</div>`
  bindSelections($('details'))
  bindRawLinks($('details'))
  $('edit-object').onclick = () => openEditor(type, o)
  if ($('duplicate-object')) $('duplicate-object').onclick = () => api({type: 'duplicate', objectType: type, id})
  if ($('delete-object')) $('delete-object').onclick = () => api({type: 'remove', objectType: type, id})
  if ($('new-node')) $('new-node').onclick = () => openEditor('snapshot', {resource: id})
  if ($('grant-to-key')) $('grant-to-key').onclick = () => openEditor('capability', {to: id})
  if ($('revoke-object')) $('revoke-object').onclick = () => openEditor('revocation', {target: id, resource: scope})
  if ($('inspect-target'))
    $('inspect-target').onclick = () => {
      if (res(o.target)) selectObject('resource', o.target)
      else toast('The target resource is not in this experiment.', true)
    }
  $('details')
    .querySelectorAll('[data-permission]')
    .forEach((el) => {
      const choose = () => {
        const [k, r] = el.dataset.permission.split(':')
        const a = access(k, r)
        $('selection-proof').innerHTML =
          `<b>${esc(name(k))} / ${esc(resourceName(r))}</b><br>` +
          (a.grants.length
            ? a.grants
                .map((gid) => {
                  const g = grantOf(gid)
                  return `<button class="inline" data-select="grant:${esc(gid)}">${esc(gid)} (${
                    g?.role
                  })</button> ← ${esc(g?.proof || 'root anchor')}`
                })
                .join('<br>')
            : a.public
              ? 'Public ResourcePolicy permits read only.'
              : 'No valid direct grant. Parent placement and follow interest grant nothing.')
        bindSelections($('selection-proof'))
      }
      el.onclick = choose
      el.onkeydown = (e) => {
        if (e.key === 'Enter') choose()
      }
    })
}

function renderMatrix() {
  const key = $('inspect-key').value
  const d = state().devices[key]
  $('matrix').innerHTML = state()
    .resources.map((r) => {
      const a = access(key, r.id)
      const custody = access(hostKey(), r.id).read
      return `<tr tabindex="0" data-r="${r.id}" aria-label="Inspect proof for ${esc(r.name)}"><td>${esc(
        r.name,
      )}<small>${esc(r.cid)} · ${r.public ? 'public' : 'private'}</small></td>${[a.read, a.write, a.admin]
        .map((v) => `<td class="${v ? 'yes' : 'no'}">${v ? '✓ ALLOW' : '× DENY'}</td>`)
        .join('')}<td class="${a.sync ? 'yes' : 'no'}">${
        a.sync ? '✓ ELIGIBLE' : !d?.online ? '○ OFFLINE' : !a.read ? '× NO READ' : !custody ? '× NO CUSTODY' : '× DENY'
      }</td><td>${
        a.admin ? 'Full' : a.grants.length ? 'Personal + state' : a.public ? 'State proof only' : 'Own revoke only'
      }</td></tr>`
    })
    .join('')
  $('matrix')
    .querySelectorAll('tr')
    .forEach((el) => {
      el.onclick = () => {
        inspected = el.dataset.r
        renderProof()
        saveUI()
      }
      el.onkeydown = (e) => {
        if (e.key === 'Enter') el.click()
      }
    })
  renderProof()
}

function renderProof() {
  const key = $('inspect-key').value
  const a = access(key, inspected)
  $('proof').innerHTML =
    `<span class="eyebrow">DECISION EXPLANATION / ${esc(resourceName(inspected))}</span><br>` +
    (a.grants.length
      ? a.grants
          .map((gid) => {
            const g = grantOf(gid)
            return `${esc(name(key))} ← ${gid} (${g?.role}) ← ${g?.proof || 'root binding'} · exact ${esc(
              res(inspected)?.cid,
            )}`
          })
          .join('<br>')
      : a.public
        ? 'Read allowed by public ResourcePolicy. No private membership roster disclosed.'
        : 'DENY: no valid grant on this original node CID; parent grants and follows do not count.') +
    `<br><span class="muted">${
      a.write
        ? 'Writer permits resource-state comments and updates.'
        : 'Writing resource state or comments requires writer.'
    } ${
      a.admin
        ? 'Permanent admin proof permits issuance and exact reader/writer revocation.'
        : 'Grant issuance and revocation require admin of this scope.'
    }</span>`
}

function renderSync() {
  const key = $('sync-key').value
  const r = $('sync-resource').value
  const s = state()
  const d = s.devices[key] || {online: false, follow: false, cache: {}, knownRevision: 0}
  const v = selectedOf(r)
  const cached = d.cache[r]
  const run = snap.sync.run
  $('online').textContent = d.online ? '● Online' : '○ Offline'
  $('online').classList.toggle('warn', !d.online)
  $('follow').textContent = d.follow ? '◉ Following' : '◎ Not following'
  $('network').classList.toggle('paused', !timer)
  $('network').innerHTML = `<div class="peer"><span class="cyan">◈</span><strong>${esc(
    name(key),
  )}’s device</strong><small>${d.online ? 'CONNECTED' : 'OFFLINE'} / ${
    d.knownRevision === s.revision ? 'CONTROL CURRENT' : 'CONTROL STALE'
  }</small></div><div class="wire"><span class="packet"></span></div><div class="peer"><span class="lime">▣</span><strong>Atlas peer</strong><small>${
    access(hostKey(), r).read ? 'CUSTODY AUTHORIZED' : 'NO RESOURCE CUSTODY'
  }</small></div>`
  const runMatches = run && run.key === key && run.resource === r
  $('trace').innerHTML = runMatches
    ? run.rows
        .map(
          (row, i) =>
            `<div class="trace-row ${row.kind || ''}"><b>${String(i + 1).padStart(2, '0')} / ${esc(
              row.title,
            )}</b><p>${esc(row.detail)}</p></div>`,
        )
        .join('') || '<p class="trace-placeholder">Session prepared. Step through the protocol or use Auto play.</p>'
    : '<p class="trace-placeholder">> Awaiting experiment<br>> Choose a principal and resource.<br>> Start a sync to see each permission check.</p>'
  $('replica').innerHTML = `<div class="replica-card">CURRENT ELIGIBLE STATEMENT<br><strong>${
    access(key, r).sync
      ? esc(v?.id || 'missing') + ' / ' + esc(name(v?.author)) + ' / ' + esc(renditionOf(r).status)
      : 'not disclosed to active key'
  }</strong><br><br>RETAINED LOCALLY<br><strong>${
    cached
      ? esc(cached.id) +
        ' / ' +
        esc(
          cached.kind === 'tombstone'
            ? 'Retained tombstone'
            : cached.kind === 'redirect'
              ? 'Retained redirect'
              : ['changes', 'changes-snapshot'].includes(cached.kind)
                ? 'Retained DAG statement · materialization incomplete or unsupported'
                : cached.kind === 'republish'
                  ? 'Retained unsupported republish placeholder'
                  : cached.text ?? JSON.stringify(cached.state),
        )
      : 'No cached state'
  }</strong><br><span class="${cached && cached.id !== v?.id ? 'warn' : 'muted'}">${
    cached
      ? d.knownRevision !== s.revision || !d.online
        ? 'Stale authority knowledge · bytes retained'
        : cached.id !== v?.id
          ? 'Cached version differs from current selection'
          : 'Verified at last completed sync'
      : 'No content fetched'
  }</span></div>`
  $('outbox').innerHTML = s.outbox
    .filter((j) => j.author === $('edit-key').value)
    .map(
      (j) =>
        `<div class="outbox-job">${esc(j.id)} / ${esc(j.version)}<br><span class="${
          j.status === 'INDEXED' ? 'yes' : 'warn'
        }">${esc(j.status)}</span></div>`,
    )
    .join('')
  const stepsLeft = runMatches && !run.done
  $('step-sync').disabled = !stepsLeft
  $('auto-sync').disabled = !stepsLeft
  $('auto-sync').textContent = timer ? 'Ⅱ Pause' : 'Auto play'
  if (!stepsLeft) stop()
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

async function begin() {
  stop()
  await api({type: 'syncBegin', key: $('sync-key').value, resource: $('sync-resource').value})
}

async function step() {
  if (!snap.sync.run || snap.sync.run.done) return stop()
  await api({type: 'syncStep'})
}

// ---- static controls ----

$('grant-form').onsubmit = (e) => {
  e.preventDefault()
  api({
    type: 'issue',
    actor: $('issuer').value,
    to: $('recipient').value,
    resource: $('scope').value,
    role: $('role').value,
  })
}
$('key-form').onsubmit = async (e) => {
  e.preventDefault()
  const value = $('key-name').value.trim()
  if (!value) return toast('Enter a principal name', true)
  const result = await api({type: 'createKey', name: value})
  if (result.ok) $('key-name').value = ''
}
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)))
$('authority-view').onclick = () => {
  view = 'authority'
  render()
}
$('placement-view').onclick = () => {
  view = 'placement'
  render()
}
$('blobs-view').onclick = () => {
  view = 'blobs'
  render()
}
$('fit').onclick = () => {
  $('graph-canvas').scrollTo({top: 0, left: 0})
  toast('Graph view reset. Scroll to explore larger experiments.')
}
$('inspect-key').onchange = () => {
  renderMatrix()
  saveUI()
}
for (const id of ['sync-key', 'sync-resource'])
  $(id).onchange = () => {
    stop()
    renderSync()
    saveUI()
  }
$('edit-key').onchange = () => {
  renderSync()
  saveUI()
}
$('online').onclick = () => {
  const key = $('sync-key').value
  api({type: 'setDevice', key, online: !state().devices[key]?.online})
}
$('follow').onclick = () => {
  const key = $('sync-key').value
  api({type: 'setDevice', key, follow: !state().devices[key]?.follow})
}
$('start-sync').onclick = begin
$('step-sync').onclick = step
$('auto-sync').onclick = () => {
  if (timer) {
    stop()
    renderSync()
  } else {
    timer = setInterval(step, 1100)
    renderSync()
  }
}
$('publish').onclick = () =>
  api({type: 'publish', author: $('edit-key').value, resource: $('sync-resource').value, text: $('edit-text').value})
$('deliver').onclick = () => api({type: 'deliver', author: $('edit-key').value})
$('revoke-sync').onclick = () =>
  api({type: 'revokeRoutes', key: $('sync-key').value, resource: $('sync-resource').value})
$('reset').onclick = () => {
  stop()
  api({type: 'reset'})
}
$('undo').onclick = () => {
  stop()
  api({type: 'undo'})
}
$('redo').onclick = () => {
  stop()
  api({type: 'redo'})
}
$('export').onclick = () => {
  const a = document.createElement('a')
  a.href = API + '/export'
  a.download = 'hm26-lab.json'
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
  stop()
  await api({type: 'import', state: parsed?.state ?? parsed})
}

// ---- free play recipes ----

function renderScenarios() {
  $('scenario-grid').innerHTML = snap.scenarios
    .map(
      (x, i) =>
        `<article class="panel scenario"><span class="num">${String(i + 1).padStart(2, '0')} /</span><h3>${esc(
          x.title,
        )}</h3><p>${esc(x.description)}</p><button data-scenario="${esc(x.id)}">Load experiment ↗</button></article>`,
    )
    .join('')
  $('scenario-grid')
    .querySelectorAll('button')
    .forEach(
      (b) =>
        (b.onclick = () => {
          stop()
          selection = {type: 'resource', id: 'lab'}
          graphScope = 'all'
          api({type: 'loadScenario', id: b.dataset.scenario})
        }),
    )
}

// ---- editor ----

const objectEditor = createObjectEditor({
  snapshot: () => snap,
  get selection() {
    return selection
  },
  res,
  name,
  resourceName,
  selectedRecord,
  api,
  afterAction,
})
const openEditor = objectEditor.open

// ---- raw ledger ----

function recordHash(type, id) {
  return '#record=' + encodeURIComponent(type + ':' + id)
}

function hashRecord(hash) {
  const token = hash.split('record=')[1]
  if (!token) return null
  try {
    const [type, id] = decodeURIComponent(token).split(':')
    return RECORD_TYPES.includes(type) && /^[-\w]+$/.test(id) ? {type, id} : null
  } catch {
    return null
  }
}

function rawLink(type, id, label = 'raw data') {
  return `<a class="raw-link" href="${esc(recordHash(type, id))}" data-raw="${type}:${esc(id)}">${esc(
    label,
  )} <span aria-hidden="true">↗</span></a>`
}

function bindRawLinks(root) {
  root.querySelectorAll('[data-raw]').forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault()
        const [type, id] = a.dataset.raw.split(':')
        openRaw(type, id)
      }),
  )
}

function openRaw(type, id) {
  rawFocus = {type, id}
  ledgerQuery = ''
  ledgerType = 'all'
  $('ledger-search').value = ''
  $('ledger-type').value = 'all'
  history.replaceState(null, '', location.pathname + location.search + recordHash(type, id))
  switchTab('raw')
  $('record-' + type + '-' + id)?.scrollIntoView({block: 'center', behavior: 'instant'})
}

function renderLedger() {
  const records = derived().records
  const filtered = records.filter(
    (r) =>
      (ledgerType === 'all' || r.type === ledgerType) &&
      (!ledgerQuery || JSON.stringify(r).toLowerCase().includes(ledgerQuery.toLowerCase())),
  )
  $('record-count').textContent = filtered.length + ' / ' + records.length + ' RECORDS'
  $('ledger-rows').innerHTML =
    filtered
      .map((r) => {
        const focused = rawFocus?.type === r.type && rawFocus.id === r.id
        const graphType = r.type === 'device' ? 'key' : r.type === 'offer' ? 'statement' : r.type
        const graphId = r.type === 'offer' ? r.raw.version : r.id
        return `<tr id="record-${r.type}-${esc(r.id)}" class="record-row${
          focused ? ' focused-record' : ''
        }"><td><span class="record-kind kind-${r.type}">${entityIcon(r.type)} ${r.type}</span>${rawLink(
          r.type,
          r.id,
          r.id,
        )}</td><td><b>${esc(r.label)}</b><small>${esc(r.collection)}</small></td><td>${
          r.owner ? rawLink('key', r.owner, name(r.owner)) : '—'
        }</td><td>${
          r.resource ? rawLink('resource', r.resource, resourceName(r.resource)) : '—'
        }</td><td><span class="record-status ${
          ['INVALID', 'REVOKED', 'INELIGIBLE'].includes(r.status) ? 'warn' : ''
        }">${esc(r.status)}</span></td><td><button data-copy-record="${r.type}:${esc(
          r.id,
        )}" aria-label="Copy link to ${esc(r.id)}">Copy link</button>${
          r.type !== 'meta' ? `<button data-world-record="${graphType}:${esc(graphId)}">Inspect →</button>` : ''
        }</td></tr>${
          focused
            ? `<tr class="raw-expansion"><td colspan="6"><div class="raw-record-head"><b>${esc(r.collection)} / ${esc(
                r.id,
              )}</b><span>${
                r.type === 'grant' ? 'IMMUTABLE SIGNED GRANT' : 'EXACT MODEL DATA'
              }</span></div><div class="raw-reference-links">${r.refs
                .map((ref) => rawLink(ref.type, ref.id, ref.label))
                .join('')}</div><pre tabindex="0">${esc(JSON.stringify(r.raw, null, 2))}</pre></td></tr>`
            : ''
        }`
      })
      .join('') || '<tr><td colspan="6">No records match. Clear the search or choose another type.</td></tr>'
  bindRawLinks($('ledger-rows'))
  $('ledger-rows')
    .querySelectorAll('[data-world-record]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const [type, id] = b.dataset.worldRecord.split(':')
          selection = {type, id}
          if (['statement', 'change', 'revocation', 'policy'].includes(type)) view = 'blobs'
          graphScope = 'all'
          switchTab('graph')
          $('details').scrollIntoView({block: 'nearest', behavior: 'instant'})
        }),
    )
  $('ledger-rows')
    .querySelectorAll('[data-copy-record]')
    .forEach(
      (b) =>
        (b.onclick = async () => {
          const [type, id] = b.dataset.copyRecord.split(':')
          const href = location.origin + location.pathname + location.search + recordHash(type, id)
          try {
            await navigator.clipboard.writeText(href)
            toast('Copied a link to ' + id + ' in the raw ledger of this node.')
          } catch {
            toast('Use the record ID link: right-click and copy its address.')
          }
        }),
    )
}
$('ledger-search').oninput = () => {
  ledgerQuery = $('ledger-search').value
  renderLedger()
}
$('ledger-type').onchange = () => {
  ledgerType = $('ledger-type').value
  renderLedger()
}

// ---- missions ----

function renderMissions() {
  const game = snap.game
  const missions = game.missions
  const progress = game.progress
  $('player-progress').innerHTML = `<div class="rank-stamp"><span>OPERATOR RANK</span><b>${esc(
    progress.rank,
  )}</b><strong>${progress.xp}<small>XP</small></strong><div class="xp-track"><i style="width:${
    (100 * progress.solved) / missions.length
  }%"></i></div><small>${progress.solved} / ${missions.length} missions solved</small></div>`
  $('mission-grid').innerHTML = missions
    .map((m, i) => {
      const solved = game.completed.includes(m.id)
      return `<article class="mission-card ${solved ? 'solved' : ''}"><div class="mission-card-top"><span>${esc(
        m.chapter,
      )}</span><b>${solved ? '✓ SOLVED' : String(i + 1).padStart(2, '0')}</b></div><h3>${esc(m.title)}</h3><p>${esc(
        m.story,
      )}</p><div class="mission-card-bottom"><span>+${m.xp} XP · ${
        m.checks.length
      } objectives</span><button data-mission="${m.id}" ${game.active === m.id ? 'class="primary"' : ''}>${
        game.active === m.id ? 'Restart puzzle' : solved ? 'Play again' : 'Start mission'
      } →</button></div></article>`
    })
    .join('')
  $('mission-grid')
    .querySelectorAll('[data-mission]')
    .forEach((b) => (b.onclick = () => startMission(b.dataset.mission)))
  const m = missions.find((m) => m.id === game.active)
  $('mission-banner').hidden = !m || tab === 'missions'
  if (!m) {
    $('mission-banner').innerHTML = ''
    return
  }
  const checks = m.checks
  const count = checks.filter((c) => c.passed).length
  const actionLabels = {
    grant: 'Issue a grant',
    reissue: 'Reissue g4',
    revoke: 'Revoke ' + (m.target || 'g4'),
    redirect: 'Create redirect',
    tombstone: 'Create tombstone',
    sync: 'Open sync',
  }
  $('mission-banner').innerHTML = `<div class="mission-active ${
    game.feedback === 'complete' ? 'mission-complete' : ''
  }"><div class="mission-active-title"><div><span class="eyebrow">${esc(m.chapter)} · ${count}/${
    checks.length
  } OBJECTIVES</span><h2>${esc(
    m.title,
  )}</h2></div><div><button id="leave-mission" class="quiet">Continue in free play</button><button id="check-mission" class="primary">Check solution ✓</button></div></div><p>${esc(
    m.story,
  )}</p><div class="mission-objectives">${checks
    .map((c) => `<span class="${c.passed ? 'passed' : ''}"><b>${c.passed ? '✓' : '○'}</b>${esc(c.label)}</span>`)
    .join('')}</div><div class="mission-rule"><b>RULE TO DISCOVER</b><span>${esc(
    m.rule,
  )}</span></div><div class="mission-tools"><button id="mission-action">${
    actionLabels[m.action]
  } →</button><button id="mission-sync">Sync ${
    m.key === 'carol' ? 'Bob' : esc(name(m.key))
  } ⇄</button><button id="mission-hint">${
    game.hints ? 'Another hint' : 'Need a hint?'
  }</button><button id="mission-ledger">Inspect raw records ≡</button></div>${
    game.hints ? `<div class="mission-hint">${esc(m.hints[Math.min(game.hints - 1, m.hints.length - 1)])}</div>` : ''
  }${
    game.feedback
      ? `<div class="mission-feedback" role="status">${
          game.feedback === 'complete'
            ? `✓ SOLVED · ${m.xp} XP earned. ${
                progress.solved === missions.length
                  ? 'All missions complete. Keep experimenting in free play.'
                  : 'Choose another mission when you’re ready.'
              }`
            : `${count}/${checks.length} objectives satisfied. The unchecked rows show what still needs to change.`
        }<button id="next-mission">Mission control →</button></div>`
      : ''
  }</div>`
  $('check-mission').onclick = () => api({type: 'checkMission'})
  $('leave-mission').onclick = () => api({type: 'leaveMission'})
  $('mission-hint').onclick = () => api({type: 'hint'})
  $('mission-sync').onclick = () => prepareMissionSync(m)
  $('mission-ledger').onclick = () => openRaw('resource', m.scope)
  $('mission-action').onclick = () => {
    const owner = res(m.scope)?.owner
    if (m.action === 'grant') openEditor('capability', {from: owner, to: m.key, resource: m.scope, role: 'reader'})
    else if (m.action === 'reissue') openEditor('grant', grantOf('g4'))
    else if (m.action === 'revoke')
      openEditor('revocation', {target: m.target || 'g4', resource: m.scope, author: owner})
    else if (['redirect', 'tombstone'].includes(m.action))
      openEditor(m.action, {resource: m.scope, author: owner, target: m.action === 'redirect' ? 'notes' : undefined})
    else prepareMissionSync(m)
  }
  if ($('next-mission')) $('next-mission').onclick = () => switchTab('missions')
}

function prepareMissionSync(m) {
  pendingControls['sync-key'] = m.key === 'carol' ? 'bob' : m.key
  pendingControls['sync-resource'] = m.scope
  stop()
  switchTab('sync')
}

async function startMission(id) {
  stop()
  rawFocus = null
  const result = await api({type: 'startMission', id})
  if (result.ok) $('mission-banner').scrollIntoView({block: 'start', behavior: 'instant'})
}
$('free-play').onclick = () => {
  graphScope = 'all'
  if (snap.game.active) api({type: 'leaveMission'}).then(() => switchTab('graph'))
  else switchTab('graph')
}

// ---- UI persistence (this browser only; the world lives on the node) ----

function saveUI() {
  try {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        selection,
        view,
        tab,
        inspected,
        graphScope,
        controls: Object.fromEntries(CONTROL_IDS.map((id) => [id, $(id).value])),
      }),
    )
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
  if (['authority', 'placement', 'blobs'].includes(ui.view)) view = ui.view
  if (TABS.includes(ui.tab)) tab = ui.tab
  if (typeof ui.inspected === 'string') inspected = ui.inspected
  if (typeof ui.graphScope === 'string') graphScope = ui.graphScope
  if (ui.controls && typeof ui.controls === 'object')
    for (const [id, value] of Object.entries(ui.controls))
      if (CONTROL_IDS.includes(id) && typeof value === 'string') pendingControls[id] = value
}

window.addEventListener('hashchange', () => {
  const target = hashRecord(location.hash)
  if (target) openRaw(target.type, target.id)
})

// ---- boot ----
;(async () => {
  try {
    await fetchSnapshot()
  } catch (e) {
    $('node-status').textContent = 'NODE UNREACHABLE'
    toast('Could not reach the playground API on this Seed node: ' + e.message, true)
    return
  }
  restoreUI()
  renderScenarios()
  const target = hashRecord(location.hash)
  if (target) {
    rawFocus = target
    tab = 'raw'
  }
  switchTab(tab, false)
  render()
  if (target) $('record-' + target.type + '-' + target.id)?.scrollIntoView({block: 'center', behavior: 'instant'})
})()
