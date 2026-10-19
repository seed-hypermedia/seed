import {escapeHTML as e, entityIcon} from './ui.mjs'

/**
 * Render a resource-scoped authority diagram with distinct, accessible entity shapes. Everything
 * it shows comes from the snapshot: the world (`state`) and the facts the API derived from it.
 */
export function topologyHTML({snapshot, selection, view, scope, rawLink}) {
  const s = snapshot.state
  const d = snapshot.derived
  const name = (id) => s.keys.find((k) => k.id === id)?.name || id
  const selectedOf = (rid) => {
    const id = d.resources[rid]?.selected
    return id ? s.statements.find((v) => v.id === id) : undefined
  }
  const active = (type, id) => (selection.type === type && selection.id === id ? ' is-selected' : '')
  const key = (id) =>
    `<button class="identity-node${active('key', id)}" data-select="key:${e(id)}" aria-label="Inspect ${e(
      name(id),
    )}"><span class="key-orbit">${entityIcon('key')}</span><span><b>${e(name(id))}</b><small>key:${e(
      id,
    )}</small></span></button>`
  const scoped = s.resources.filter((r) => scope === 'all' || r.id === scope)
  const header = (r) =>
    `<div class="resource-heading"><button class="folder-node${active('resource', r.id)}" data-select="resource:${e(
      r.id,
    )}" aria-label="Inspect ${e(r.name)}"><span class="folder-shape">${entityIcon(
      'resource',
    )}</span><span><small>RESOURCE / EXACT SCOPE</small><b>${e(r.name)}</b><code>${e(
      d.resources[r.id]?.path ?? '',
    )}</code></span></button><div class="resource-owner"><span>OWNED BY</span>${key(
      r.owner,
    )}</div><div class="resource-meta"><span class="audience">${r.public ? 'PUBLIC' : 'PRIVATE'}</span><small>${e(
      selectedOf(r.id)?.kind || 'no selected node',
    )}</small>${rawLink('resource', r.id, 'raw ' + r.id)}</div></div>`
  let html = `<div class="keyring"><div class="diagram-caption"><b>${entityIcon(
    'key',
  )} KEYRING</b><span>Circles identify who can sign. Repeated circles refer to the same key.</span></div><div class="keyring-nodes">${s.keys
    .map((k) => key(k.id))
    .join(
      '',
    )}</div></div><div class="world-filter"><label>RESOURCE SCOPE<select id="world-scope"><option value="all">All resources</option>${s.resources
    .map((r) => `<option value="${e(r.id)}" ${scope === r.id ? 'selected' : ''}>${e(r.name)}</option>`)
    .join('')}</select></label><span>${
    view === 'authority'
      ? 'One resource per zone. Read each grant left → right.'
      : view === 'placement'
        ? 'Folders show placement. Indentation never grants authority.'
        : 'Documents are immutable statements and control evidence.'
  }</span></div>`
  if (view === 'authority')
    html += scoped
      .map((r) => {
        const grants = s.grants.filter((g) => g.resource === r.id)
        return `<section class="resource-zone${active('resource', r.id)}" aria-label="Capabilities for ${e(
          r.name,
        )}">${header(
          r,
        )}<div class="flow-column-labels"><span>ISSUING KEY</span><span>IMMUTABLE CAPABILITY</span><span>RECIPIENT KEY</span></div>${
          grants
            .map((g) => {
              const status = d.grants[g.id]?.status || 'invalid'
              return `<div class="authority-flow ${status}${
                selection.type === 'grant' && selection.id === g.id ? ' selected-flow' : ''
              }"><div class="flow-key">${key(
                g.from,
              )}</div><div class="flow-grant"><span class="flow-arrow" aria-hidden="true">→</span><button class="capability-ticket role-${
                g.role
              }${active('grant', g.id)}" data-select="grant:${e(g.id)}" aria-label="Inspect ${e(g.id)} ${
                g.role
              } capability to ${e(name(g.to))}"><span class="ticket-notch">${entityIcon('grant')}</span><span><b>${
                g.role === 'admin' ? 'PERMANENT ADMIN' : g.role.toUpperCase()
              }</b><small>${e(g.id)} · ${status}${
                g.reissuedFrom ? ' · reissued' : ''
              }</small></span></button><span class="flow-arrow" aria-hidden="true">→</span><div class="ticket-links">${rawLink(
                'grant',
                g.id,
                g.id + ' data',
              )}${
                g.proof ? rawLink('grant', g.proof, 'proof ' + g.proof) : '<span>root anchor</span>'
              }</div></div><div class="flow-key">${key(g.to)}</div></div>`
            })
            .join('') ||
          '<p class="empty-diagram">No capabilities exist on this exact resource. Its root anchor must be established before delegated grants validate.</p>'
        }<div class="zone-foot">${entityIcon('resource')} Every ticket above applies only to ${e(r.name)} (${e(
          r.cid,
        )}).</div></section>`
      })
      .join('')
  else if (view === 'placement') {
    const visible = new Set(scoped.map((r) => r.id))
    const tree = (r) =>
      `<div class="placement-branch"><section class="resource-zone">${header(
        r,
      )}<div class="placement-note"><b>name:</b> ${
        r.segment ? e(r.segment) : '<em>unset · address by CID</em>'
      }<span>Permission evaluated separately</span></div></section>${s.resources
        .filter((c) => c.parent === r.id && visible.has(c.id))
        .map(tree)
        .join('')}</div>`
    html += `<div class="placement-tree">${scoped
      .filter((r) => !r.parent || !visible.has(r.parent))
      .map(tree)
      .join('')}</div>`
  } else
    html += scoped
      .map((r) => {
        const blobs = [
          ...s.statements.filter((v) => v.resource === r.id).map((v) => ({...v, type: 'statement', label: v.kind})),
          ...s.changes.filter((v) => v.resource === r.id).map((v) => ({...v, type: 'change', label: 'Change'})),
          ...s.revocations
            .filter((v) => v.resource === r.id)
            .map((v) => ({...v, type: 'revocation', label: 'Revocation'})),
          {id: 'policy-' + r.id, type: 'policy', label: 'ResourcePolicy', author: r.owner},
        ]
        return `<section class="resource-zone">${header(r)}<div class="blob-shelf">${blobs
          .map(
            (v) =>
              `<div class="blob-wrapper"><button class="document-node${active(v.type, v.id)}" data-select="${
                v.type
              }:${e(v.id)}" aria-label="Inspect ${e(v.id)} ${e(
                v.label,
              )}"><span class="document-corner"></span>${entityIcon(v.type)}<b>${e(v.label)}</b><code>${e(
                v.id,
              )}</code><small>signer: ${e(name(v.author))}</small><span class="blob-state">${
                d.resources[r.id]?.selected === v.id ? '● selected' : 'retained'
              }</span></button>${rawLink(v.type, v.id, 'raw record')}</div>`,
          )
          .join('')}</div></section>`
      })
      .join('')
  return html
}
