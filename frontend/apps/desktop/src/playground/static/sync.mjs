import {escapeHTML as esc} from './ui.mjs'
import {syncConcepts, conceptLink as link, conceptURL, eventConcept} from './sync-concepts.mjs'

/** Render and operate the API-owned sync machine inside the existing playground. */
export function createSyncView({root, snapshot, api, render, inspect, afterAction, toast}) {
  let settings = {left: '', right: '', profile: 'cold', privacy: 'deduplicate'}
  let resource = null
  let graphMode = 'content'
  let lesson = 0
  let followStep = true
  let lastCursor = -1
  let table = 'frontier'
  let selectedBlob = null
  let playing = false
  let timer = null
  let busy = false
  const stop = () => {
    playing = false
    clearTimeout(timer)
  }
  const run = () => snapshot().syncLab
  const label = (value) => {
    const lab = run()
    const s = snapshot().state
    if (value === '') return '—'
    if (typeof value === 'boolean') return value ? 'yes' : 'no'
    if (lab?.blobs[value]) return lab.blobs[value].label
    if (
      value === lab?.peers[0]?.tables.authority_cache[0]?.revision ||
      (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    )
      return 'current revision'
    return s.keys.find((k) => k.id === value)?.name || s.resources.find((r) => r.id === value)?.name || String(value)
  }
  const humanPayload = (value) => {
    if (Array.isArray(value)) return value.map(humanPayload)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, humanPayload(v)]))
    return typeof value === 'string' ? label(value) : value
  }
  async function action(body) {
    if (busy) return
    busy = true
    const focusedAction = document.activeElement?.dataset?.syncAction
    root.querySelectorAll('button, select').forEach((el) => {
      el.disabled = true
    })
    let result
    try {
      result = await api(body, {quiet: true})
    } finally {
      busy = false
    }
    if (result?.ok) afterAction(result)
    else {
      toast(result?.error || 'Could not advance sync.', true)
      render()
    }
    if (focusedAction) root.querySelector(`[data-sync-action="${focusedAction}"]`)?.focus({preventScroll: true})
    return result
  }

  async function tick() {
    if (!playing || root.hidden) {
      stop()
      return
    }
    const result = await action({type: 'syncLabStep'})
    if (!result?.ok || (run()?.done && run().cursor === run().length - 1)) stop()
    if (playing) timer = setTimeout(tick, 850)
    render()
  }
  function graph(peer, index) {
    const lab = run()
    const scopes = lab.scopes.filter((s) => !resource || s.resource === resource)
    const relevant = new Set()
    const visible = new Set(peer.tables.blobs.map((r) => r.cid))
    const stored = new Set(visible)
    const pending = new Set(peer.tables.frontier.map((r) => r.cid))
    const edgeKind = graphMode === 'content' ? 'contains' : 'proof'
    const visit = (cid, set) => {
      if (set.has(cid)) return
      set.add(cid)
      lab.blobs[cid]?.links.filter((l) => l.kind === edgeKind).forEach((l) => visit(l.cid, set))
    }
    for (const scope of scopes) {
      const roots = graphMode === 'content' ? [scope.root] : scope.control
      roots.forEach((cid) => visit(cid, relevant))
      if (snapshot().derived.access[peer.key]?.[scope.resource]?.read) {
        const outlines = new Set()
        roots.forEach((cid) => visit(cid, outlines))
        outlines.forEach((cid) => visible.add(cid))
      }
    }
    const ids = [...relevant]
    const catalog = ids.map(
      (cid) => lab.blobs[cid] || {cid, kind: 'missing', label: 'Unresolved dependency', links: []},
    )
    const nodes = catalog.filter((b) => visible.has(b.cid) || pending.has(b.cid))
    if (!nodes.length)
      return `<div class="sync-empty"><span>—</span><h3>No ${
        graphMode === 'content' ? 'content' : 'evidence'
      } to show</h3><p>No local blocks or readable resource in this view.</p>${link(
        'authority',
        'How read access works ↗',
      )}</div>`
    // Layout comes from the observer catalog, never the changing per-peer inventory.
    const ranks = new Map()
    function rank(cid, trail = new Set()) {
      if (ranks.has(cid)) return ranks.get(cid)
      if (trail.has(cid)) return 0
      const deps = lab.blobs[cid]?.links.filter((l) => l.kind === edgeKind && relevant.has(l.cid)) || []
      const n = deps.length ? 1 + Math.max(...deps.map((l) => rank(l.cid, new Set([...trail, cid])))) : 0
      ranks.set(cid, n)
      return n
    }
    catalog.forEach((b) => rank(b.cid))
    const maxRank = Math.max(...ranks.values())
    const rows = Array.from({length: maxRank + 1}, () => [])
    catalog.forEach((b) => rows[maxRank - ranks.get(b.cid)].push(b))
    const width = Math.max(640, Math.min(8, Math.max(...rows.map((r) => r.length))) * 160)
    const positions = new Map()
    let rowOffset = 0
    rows.forEach((row) => {
      row.forEach((b, x) => {
        const count = Math.min(8, row.length - Math.floor(x / 8) * 8)
        positions.set(b.cid, {
          x: width / 2 + ((x % 8) - (count - 1) / 2) * 160,
          y: (rowOffset + Math.floor(x / 8)) * 104 + 48,
        })
      })
      rowOffset += Math.ceil(row.length / 8)
    })
    const height = rowOffset * 104 + 16
    const active = new Set(lab.event.active)
    const affected =
      lab.event.kind === 'request' ||
      lab.event.kind === 'response' ||
      lab.event.from === index ||
      lab.event.sql.some((s) => s.peer === index)
    const shown = new Set(nodes.map((n) => n.cid))
    const edges = nodes
      .flatMap((b) =>
        b.links
          .filter((l) => l.kind === edgeKind && shown.has(l.cid))
          .map((l) => {
            const a = positions.get(b.cid),
              z = positions.get(l.cid)
            return `<path class="sync-edge ${l.kind}${active.has(b.cid) && affected ? ' lit' : ''}${
              selectedBlob === b.cid || selectedBlob === l.cid ? ' selected' : ''
            }" d="M${a.x} ${a.y + 32} C${a.x} ${a.y + 64},${z.x} ${z.y - 64},${z.x} ${
              z.y - 32
            }" marker-end="url(#sync-arrow-${index})"/>`
          }),
      )
      .join('')
    const blocks = nodes
      .map((b) => {
        const p = positions.get(b.cid)
        const complete = peer.tables.complete.some((r) => r.cid === b.cid)
        const status = stored.has(b.cid) ? (complete ? 'complete' : 'stored') : pending.has(b.cid) ? 'pending' : 'ghost'
        const statusText = {complete: '✓ Complete', stored: 'Stored', pending: 'To fetch', ghost: 'Not held'}[status]
        const title = {
          ref: 'Selected version',
          manifest: 'Packing list',
          chunk: 'Content',
          resource: 'Resource policy',
          grant: 'Grant',
          revocation: 'Revocation',
          change: 'Change',
          missing: 'Missing dependency',
        }[b.kind]
        const displayLabel =
          b.kind === 'manifest'
            ? `${b.links.filter((l) => l.kind === 'contains').length} child addresses`
            : b.kind === 'ref'
              ? b.label.split(' · ')[0]
              : b.label
        const shortLabel = displayLabel.length > 23 ? displayLabel.slice(0, 22) + '…' : displayLabel
        return `<g class="sync-node ${b.kind} ${status}${active.has(b.cid) && affected ? ' lit' : ''}${
          selectedBlob === b.cid ? ' selected' : ''
        }" data-sync-blob="${esc(b.cid)}" data-position="${p.x},${p.y}" role="button" tabindex="0" aria-label="${esc(
          b.label,
        )} · ${statusText}"><title>${esc(
          b.label,
        )} · ${title} · ${statusText}. Select for explanation.</title><rect x="${p.x - 74}" y="${
          p.y - 32
        }" width="148" height="64" rx="6"/><text x="${p.x - 62}" y="${
          p.y - 15
        }" class="sync-node-type">${title}</text><text x="${p.x - 62}" y="${p.y + 3}">${esc(
          shortLabel,
        )}</text><text x="${p.x - 62}" y="${
          p.y + 21
        }" class="sync-node-status">${statusText}</text></g><a class="sync-node-doc" href="${conceptURL(
          b.kind,
        )}" data-hm data-concept="${b.kind}" target="_blank" rel="noreferrer" aria-label="Learn about ${esc(
          syncConcepts[b.kind].title,
        )}"><text x="${p.x + 54}" y="${p.y - 15}">↗</text></a>`
      })
      .join('')
    return `<div class="sync-graph-scroll"><svg class="sync-graph" viewBox="0 0 ${width} ${height}" style="min-width:${Math.min(
      width,
      480,
    )}px" role="group" aria-label="${esc(
      peer.name,
    )} ${graphMode} dependency graph"><defs><marker id="sync-arrow-${index}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${edges}${blocks}</svg></div>`
  }
  function tables(peer, index) {
    const rows = peer.tables[table]
    const columns = rows.length ? Object.keys(rows[0]) : []
    const active = run().event.sql.some((q) => q.peer === index && q.tables.includes(table))
    const currentIds = new Set(run().event.active)
    return `<div class="sync-table ${active ? 'lit' : ''}"><div class="sync-table-head"><span>${esc(
      peer.name,
    )} <span class="muted">/ ${esc(table)}</span></span><span>${rows.length} rows${
      active ? ' · active' : ''
    }</span></div><div class="sync-table-scroll">${
      rows.length
        ? `<table><thead><tr>${columns
            .map(
              (c) =>
                `<th>${link(
                  {
                    cid: 'cid',
                    parent: 'edges',
                    child: 'edges',
                    kind: 'blob',
                    bytes: 'blob',
                    verified: 'stored',
                    principal: 'principal',
                    resource: 'resource',
                    revision: 'revision',
                    can_read: 'authority_cache',
                    head: 'ref',
                    rules: 'complete',
                  }[c] || 'sql',
                  c.replaceAll('_', ' '),
                )}</th>`,
            )
            .join('')}</tr></thead><tbody>${rows
            .map(
              (row) =>
                `<tr class="${
                  active && Object.values(row).some((v) => currentIds.has(v)) ? 'sync-row-active' : ''
                }">${columns.map((c) => `<td>${esc(label(row[c]))}</td>`).join('')}</tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="muted sync-no-rows">No rows at this step.</p>'
    }</div></div>`
  }
  function renderView() {
    const s = snapshot().state
    const lab = run()
    const defaultLeft = s.keys.find((k) => k.id === 'alice')?.id || s.keys[0]?.id
    if (!s.keys.some((k) => k.id === settings.left)) settings.left = defaultLeft
    if (!s.keys.some((k) => k.id === settings.right) || settings.right === settings.left)
      settings.right =
        s.keys.find((k) => k.id === 'bob' && k.id !== settings.left)?.id ||
        s.keys.find((k) => k.id !== settings.left)?.id
    if (lab) settings = {...lab.options, ...settings}
    if (lab && (resource === null || (resource && !s.resources.some((r) => r.id === resource))))
      resource = lab.scopes[0]?.resource || ''
    if (lab && lab.cursor !== lastCursor) {
      lastCursor = lab.cursor
      if (followStep && lab.cursor === 0) {
        resource = lab.scopes[0]?.resource || ''
        graphMode = 'content'
      }
      if (followStep && lab.event.active.length) {
        const active = new Set(lab.event.active)
        graphMode = lab.event.active.some((cid) => ['resource', 'grant', 'revocation'].includes(lab.blobs[cid]?.kind))
          ? 'authority'
          : 'content'
        const belongs = (scope) => {
          const visited = new Set()
          const visit = (cid) => {
            if (visited.has(cid)) return false
            visited.add(cid)
            return active.has(cid) || !!lab.blobs[cid]?.links.some((l) => l.kind === 'contains' && visit(l.cid))
          }
          return graphMode === 'authority' ? scope.control.some((cid) => active.has(cid)) : visit(scope.root)
        }
        const matching = lab.scopes.filter(belongs)
        if (!matching.some((scope) => scope.resource === resource) && matching[0]) resource = matching[0].resource
      }
    }
    if (lab?.done && lab.cursor === lab.length - 1) stop()
    const options = (selected) =>
      s.keys
        .map((k) => `<option value="${esc(k.id)}" ${selected === k.id ? 'selected' : ''}>${esc(k.name)}</option>`)
        .join('')
    const config = `<div class="sync-setup"><label>${link('peer', 'Peer A')}<select data-sync-setting="left">${options(
      settings.left,
    )}</select></label><span class="sync-between" aria-hidden="true">⇄</span><label>${link(
      'peer',
      'Peer B',
    )}<select data-sync-setting="right">${options(settings.right)}</select></label><label>${link(
      'stored',
      'Starting storage',
    )}<select data-sync-setting="profile">${[
      ['cold', 'A full · B empty'],
      ['shared', 'B has a complete subtree'],
      ['partial', 'B has heads, missing content'],
      ['split', 'Split resources between peers'],
    ]
      .map(([v, l]) => `<option value="${v}" ${v === settings.profile ? 'selected' : ''}>${l}</option>`)
      .join('')}</select></label><label>${link(
      'privacy',
      'Possession privacy',
    )}<select data-sync-setting="privacy"><option value="deduplicate" ${
      settings.privacy === 'deduplicate' ? 'selected' : ''
    }>Reuse complete subtrees</option><option value="scoped" ${
      settings.privacy === 'scoped' ? 'selected' : ''
    }>Uniform transfer · hide reuse</option></select></label><button data-sync-action="build">${
      lab ? 'Rebuild replicas' : 'Build replicas'
    }</button></div>`
    const intro = `<div class="sync-heading"><div><div class="eyebrow">Protocol workbench</div><h3>Same content. Two separate copies.</h3></div><button data-sync-action="example">Load shared-DAG example</button></div>`
    if (!lab) {
      root.innerHTML = `${intro}${config}<div class="sync-welcome"><div class="sync-welcome-peers"><span>A</span><i>⇄</i><span>B</span></div><h3>See what moves. See why it’s allowed.</h3><p>Build two replicas from this world, then step through authority, resource heads, and missing content.</p><p class="muted">Try the shared-DAG example to see overlap and private boundaries.</p></div>`
      bind()
      return
    }
    const e = lab.event
    const end = lab.done && lab.cursor === lab.length - 1
    const b = lab.blobs[selectedBlob]
    const sqlText = e.sql.map((q) => `-- ${lab.peers[q.peer].name}\n${q.statement}`).join('\n\n')
    root.innerHTML = `${intro}<details class="sync-config"><summary>Replica setup · ${esc(
      lab.peers.map((p) => p.name).join(' ⇄ '),
    )}</summary>${config}</details>
      <div class="sync-transport"><div class="sync-playback"><button data-sync-action="reset" aria-label="Rewind to beginning" ${
        lab.cursor ? '' : 'disabled'
      }>↤</button><button data-sync-action="back" aria-label="Previous step" ${
        lab.cursor ? '' : 'disabled'
      }>←</button><button data-sync-action="play" ${end ? 'disabled' : ''}>${
        playing ? 'Pause' : 'Play'
      }</button><button class="primary" data-sync-action="next" ${
        end ? 'disabled' : ''
      }>Step →</button></div><div class="sync-step-count">${String(lab.cursor).padStart(
        2,
        '0',
      )} <span class="muted">/ ${lab.length - 1}${
        end ? ' · finished' : ' · exploring'
      }</span></div><div class="sync-metrics"><span><b>${lab.transferred.toLocaleString()}</b> ${link(
        'chunk',
        'content B transferred',
      )}</span><span><b>${lab.skipped}</b> ${link('complete', 'subtrees skipped')}</span></div></div>
      <div class="sync-current ${
        e.kind === 'blocked' ? 'blocked' : ''
      }" role="status" aria-live="polite"><div class="sync-current-kind">${esc(e.kind)}${
        e.method ? `<span>${esc(lab.peers[e.from].name)} → ${esc(lab.peers[e.to].name)}</span>` : ''
      }</div><div><h3>${link(eventConcept(e), e.title + ' ↗')}</h3><p>${esc(e.detail)}</p></div></div>
      <div class="sync-graph-toolbar"><label>${link(
        'resource',
        'Resource',
      )}<select id="sync-resource"><option value="">All resources · advanced</option>${s.resources
        .map((r) => `<option value="${esc(r.id)}" ${resource === r.id ? 'selected' : ''}>${esc(r.name)}</option>`)
        .join(
          '',
        )}</select></label><div class="sync-view-switch" role="group" aria-label="Graph layers"><button data-sync-mode="content" aria-pressed="${
        graphMode === 'content'
      }">Content</button><button data-sync-mode="authority" aria-pressed="${
        graphMode === 'authority'
      }">Permissions</button></div><label class="sync-follow"><input type="checkbox" id="sync-follow" ${
        followStep ? 'checked' : ''
      }/>Follow this step</label><button data-sync-action="learn">${
        lesson < 0 ? 'Help me read this' : 'Hide guide'
      }</button></div>
      ${
        lesson < 0
          ? ''
          : `<div class="sync-lesson"><span class="sync-lesson-number">${lesson + 1} / 4</span><div><h3>${
              [
                'Read it like a packing list.',
                'Compare the same position on both sides.',
                'Permission is a separate question.',
                'One step is one small action.',
              ][lesson]
            }</h3><p>${
              [
                `${link('ref', 'Selected version')} → ${link('manifest', 'packing lists')} → ${link(
                  'chunk',
                  'actual content',
                )}. Read each arrow as “needs this.” A shared child is stored only once. ${link(
                  'dag',
                  'Why it is a DAG ↗',
                )}`,
                `Solid means ${link('stored', 'stored')}. A check means the ${link(
                  'complete',
                  'whole subtree is complete',
                )}. Dashed ${link(
                  'missing',
                  'outlines',
                )} show what is missing; they do not mean the peer knows those addresses yet.`,
                `${link('authority', 'Permissions')} answers “may this peer receive it?” Each ${link(
                  'grant',
                  'grant',
                )} points to the ${link(
                  'proof',
                  'proof',
                )} it needs. Holding bytes and having permission are different facts.`,
                `Press Step. A ${link('rpc', 'request')} asks; a response delivers; a ${link(
                  'walk',
                  'local walk',
                )} checks storage. ${link(
                  'active',
                  'Green',
                )} shows what participates. Click any box, message or underlined concept to learn more.`,
              ][lesson]
            }</p></div><div class="sync-lesson-controls"><button data-sync-action="lesson-back" aria-label="Previous lesson" ${
              lesson === 0 ? 'disabled' : ''
            }>←</button><button data-sync-action="lesson-next">${
              lesson === 3 ? 'Got it' : 'Next →'
            }</button></div></div>`
      }
      <div class="sync-reading-key"><span>${
        graphMode === 'content'
          ? `${link('ref', 'Version')} → ${link('manifest', 'Packing lists')} → ${link('chunk', 'Content')}`
          : `${link('grant', 'Grant')} → ${link('proof', 'Required proof')} → ${link('resource', 'Root policy')}`
      }</span><span>${link('stored', '● Stored')} · ${link('complete', '✓ Complete')} · ${link(
        'missing',
        '┄ Not held',
      )} · ${link('frontier', 'To fetch')} · ${link('active', 'Green = this step')}</span></div>
      <div class="sync-peers">${lab.peers
        .map(
          (p, i) =>
            `<section class="sync-peer"><div class="sync-peer-head"><div><span class="sync-peer-letter">${
              i ? 'B' : 'A'
            }</span><strong>${esc(p.name)}</strong></div><span class="muted">${
              p.tables.blobs.length
            } blocks in store</span></div>${graph(p, i)}</section>`,
        )
        .join('')}</div>
      ${
        b
          ? `<div class="sync-blob-detail"><div><span class="eyebrow">${link(b.kind)}</span><h3>${esc(
              b.label,
            )}</h3><p>${esc(syncConcepts[b.kind].summary)}</p><p class="muted">${esc(
              syncConcepts[b.kind].detail,
            )}</p>${link(b.kind, 'Read the Seed explanation ↗')}<div class="sync-dependencies">${
              b.links.length
                ? b.links
                    .map(
                      (l) =>
                        `<span>${link(l.kind)} → <button data-sync-blob="${esc(l.cid)}">${esc(
                          lab.blobs[l.cid]?.label || 'Unresolved dependency',
                        )}</button></span>`,
                    )
                    .join('')
                : 'No outgoing dependencies.'
            }</div></div><div>${
              b.object ? '<button data-sync-action="inspect">Open in world editor ↗</button>' : ''
            }<button data-sync-action="close-blob" aria-label="Close block details">×</button></div><details><summary>Stored envelope · ${
              b.bytes
            } bytes</summary><pre>${esc(
              JSON.stringify(humanPayload(JSON.parse(b.data)), null, 2),
            )}</pre></details></div>`
          : ''
      }
      <div class="sync-bottom"><section class="sync-storage"><div class="sync-section-title"><h2>${link(
        'sql',
        'Local SQL state ↗',
      )}</h2><span class="muted">Simulated indexed tables</span></div><div class="sync-table-tabs" role="tablist" aria-label="SQL tables">${Object.keys(
        lab.schemas,
      )
        .map(
          (t) =>
            `<button role="tab" aria-selected="${table === t}" data-sync-table="${t}" class="${
              table === t ? 'active' : ''
            }">${t}</button>`,
        )
        .join('')}</div><p class="sync-table-explanation">${link(
        table === 'complete' ? 'complete_table' : table,
        table + ' ↗',
      )} · ${esc(
        syncConcepts[table === 'complete' ? 'complete_table' : table].summary,
      )}</p><div class="sync-tables">${lab.peers
        .map(tables)
        .join('')}</div><details><summary>Schema & indexes</summary><p>${link(
        'sql',
        'How these tables work ↗',
      )}</p><pre>${esc(lab.schemas[table])}</pre></details><details ${
        e.sql.length ? 'open' : ''
      }><summary>SQL at this step</summary><pre>${esc(
        sqlText || 'No local storage operation at this step.',
      )}</pre></details></section>
      <section class="sync-wire"><div class="sync-section-title"><h2>${link(
        'rpc',
        'Exchange log ↗',
      )}</h2><span class="muted">Click to rewind</span></div><div class="sync-trace">${lab.trace
        .map(
          (event, i) =>
            `<div class="sync-trace-row"><button data-sync-seek="${i}" class="${i === lab.cursor ? 'active' : ''} ${
              i > lab.cursor ? 'future' : ''
            }"><span>${String(i).padStart(2, '0')}</span><span>${esc(event.title)}<small>${
              event.method ? esc(lab.peers[event.from].name) + ' → ' + esc(lab.peers[event.to].name) : esc(event.kind)
            }</small></span></button>${link(eventConcept(event), 'Learn ↗')}</div>`,
        )
        .join('')}</div><details ${e.payload ? 'open' : ''}><summary>RPC payload · names resolved</summary><p>${link(
        eventConcept(e),
        'What this message means ↗',
      )}</p><pre>${esc(JSON.stringify(humanPayload(e.payload || {}), null, 2))}</pre></details></section></div>
      <details class="sync-glossary"><summary>Concept index · ${
        Object.keys(syncConcepts).length
      } Seed explanations</summary><div>${Object.entries(syncConcepts)
        .map(([key, concept]) => `<p>${link(key)}<span>${esc(concept.summary)}</span></p>`)
        .join('')}</div></details>
      <p class="sync-footnote">${link(
        'missing',
        'Observer view',
      )}: outlines come from the teaching catalog. Only the ${link('rpc', 'RPC payload')} crosses the wire. ${link(
        'cid',
        'Hashes',
      )}, ${link('rbsr', 'head reconciliation')}, ${link('privacy', 'possession privacy')} and ${link(
        'sql',
        'SQL',
      )} have documented simulation limits.</p>`
    bind()
    const trace = root.querySelector('.sync-trace')
    const current = trace?.querySelector('.active')
    if (current) trace.scrollTop = current.offsetTop - trace.offsetTop - trace.clientHeight / 2
  }
  function bind() {
    const follow = root.querySelector('#sync-follow')
    if (follow)
      follow.onchange = () => {
        followStep = follow.checked
        lastCursor = -1
        render()
        root.querySelector('#sync-follow')?.focus({preventScroll: true})
      }
    root.querySelectorAll('[data-sync-mode]').forEach((el) => {
      el.onclick = () => {
        graphMode = el.dataset.syncMode
        followStep = false
        selectedBlob = null
        render()
        root.querySelector(`[data-sync-mode="${graphMode}"]`)?.focus({preventScroll: true})
      }
    })
    root.querySelectorAll('[data-sync-setting]').forEach(
      (el) =>
        (el.onchange = () => {
          stop()
          settings[el.dataset.syncSetting] = el.value
        }),
    )
    root.querySelectorAll('[data-sync-table]').forEach(
      (el) =>
        (el.onclick = () => {
          table = el.dataset.syncTable
          render()
          root.querySelector(`[data-sync-table="${table}"]`)?.focus({preventScroll: true})
        }),
    )
    root.querySelectorAll('[data-sync-seek]').forEach(
      (el) =>
        (el.onclick = () => {
          stop()
          action({type: 'syncLabSeek', index: Number(el.dataset.syncSeek)})
        }),
    )
    root.querySelectorAll('[data-sync-blob]').forEach((el) => {
      el.onclick = () => {
        selectedBlob = el.dataset.syncBlob
        render()
        root.querySelector('.sync-blob-detail')?.scrollIntoView?.({block: 'nearest'})
        root.querySelector('.sync-blob-detail a')?.focus({preventScroll: true})
      }
      el.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          el.onclick()
        }
      }
    })
    const resourceSelect = root.querySelector('#sync-resource')
    if (resourceSelect)
      resourceSelect.onchange = () => {
        resource = resourceSelect.value
        followStep = false
        selectedBlob = null
        render()
        root.querySelector('#sync-resource')?.focus({preventScroll: true})
      }
    root.querySelectorAll('[data-sync-action]').forEach(
      (el) =>
        (el.onclick = async () => {
          const act = el.dataset.syncAction
          if (act !== 'play') stop()
          if (act === 'learn') {
            lesson = lesson < 0 ? 0 : -1
            render()
          }
          if (act === 'lesson-back' || act === 'lesson-next') {
            followStep = false
            lesson += act === 'lesson-back' ? -1 : 1
            if (lesson > 3) lesson = -1
            if (lesson === 0 || lesson === 1) graphMode = 'content'
            if (lesson === 2) graphMode = 'authority'
            if (lesson === 3) graphMode = 'content'
            selectedBlob = null
            render()
            root.querySelector(`[data-sync-action="${lesson < 0 ? 'learn' : act}"]`)?.focus({preventScroll: true})
          }
          if (act === 'build') {
            lastCursor = -1
            selectedBlob = null
            await action({type: 'syncLabBegin', ...settings})
          }
          if (act === 'next') await action({type: 'syncLabStep'})
          if (act === 'back' || act === 'reset')
            await action({type: 'syncLabSeek', index: act === 'reset' ? 0 : run().cursor - 1})
          if (act === 'play') {
            if (playing) {
              stop()
              render()
            } else {
              playing = true
              tick()
            }
          }
          if (act === 'inspect') inspect(run().blobs[selectedBlob].object)
          if (act === 'close-blob') {
            selectedBlob = null
            render()
          }
          if (act === 'example') {
            const result = await action({type: 'loadScenario', id: 'sync-sharing'})
            if (result?.ok) {
              settings.left = 'alice'
              settings.right = 'bob'
              resource = null
              graphMode = 'content'
              followStep = true
              lastCursor = -1
              lesson = 0
              selectedBlob = null
              await action({type: 'syncLabBegin', ...settings})
            }
          }
        }),
    )
  }
  return {render: renderView}
}
