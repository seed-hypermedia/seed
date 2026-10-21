import {escapeHTML as esc} from './ui.mjs'

/**
 * The blob editor: one short form per blob type. It only collects fields; the playground API
 * fills in proofs and sequence numbers, then validates and applies the result.
 */
export function createObjectEditor(ctx) {
  const $ = (id) => document.getElementById(id)
  let editing = null
  const types = [
    ['key', 'Key'],
    ['resource', 'Resource'],
    ['capability', 'Capability'],
    ['revocation', 'Revocation'],
    ['statement', 'Ref'],
    ['policy', 'Resource policy'],
  ]
  const kinds = ['snapshot', 'tombstone', 'redirect']
  const state = () => ctx.snapshot().state
  const input = (label, id, value = '', extra = '', help = '') =>
    `<label>${label}<input id="${id}" value="${esc(value)}" ${extra}>${help ? `<small>${help}</small>` : ''}</label>`
  const select = (label, id, items, value, help = '') =>
    `<label>${label}<select id="${id}">${items
      .map((x) => `<option value="${esc(x.id)}" ${x.id === value ? 'selected' : ''}>${esc(x.name)}</option>`)
      .join('')}</select>${help ? `<small>${help}</small>` : ''}</label>`
  const yesNo = (label, id, value) =>
    select(
      label,
      id,
      [
        {id: 'false', name: 'Private'},
        {id: 'true', name: 'Public'},
      ],
      String(value),
    )

  /** Open the editor to add a blob of `type`, or to edit or reissue the object `o`. */
  function open(type, o = {}) {
    if (type === 'grant') type = 'capability'
    if (kinds.includes(type)) type = 'statement'
    const s = state()
    const reissuing = type === 'capability' && !!o.id && s.grants.some((g) => g.id === o.id)
    const exists =
      !!o.id &&
      !reissuing &&
      (type === 'policy' ||
        ['keys', 'resources', 'statements', 'revocations'].some((g) => s[g].some((x) => x.id === o.id)))
    editing = {type, o: structuredClone(o), exists, reissuing}
    render()
    $('editor-dialog').showModal()
  }

  function render() {
    const {type, o, exists, reissuing} = editing
    const s = state()
    const scope = o.resource || ctx.scope() || s.resources[0].id
    const schema = ctx.schemaLink(type === 'capability' ? 'grant' : type, o)
    const owner = ctx.res(scope)?.owner || s.keys[0].id
    $('editor-title').textContent =
      (reissuing ? 'Reissue ' : exists ? 'Edit ' : 'Add ') + types.find((t) => t[0] === type)[1].toLowerCase()
    $('save-object').textContent = reissuing ? 'Issue new capability' : 'Save'
    $('editor-error').textContent = ''
    let html = ''
    if (!exists && !reissuing)
      html += select(
        'Blob type',
        'blob-type',
        types.map(([id, name]) => ({id, name})),
        type,
      )
    if (reissuing)
      html += `<p class="note">${esc(
        o.id,
      )} stays as it is. This issues a new grant with a new id. Revoke the old one separately if you mean to replace it.</p>`
    if (type === 'key') html += input('Name', 'f-name', o.name || '', 'required maxlength="60"')
    else if (type === 'resource') {
      const r = {owner, parent: null, segment: '', public: false, ...o}
      html +=
        input('Name', 'f-name', r.name || '', 'required maxlength="60"') +
        select('Owner', 'f-owner', s.keys, r.owner, 'The trusted root of the resource. It is the implicit admin.') +
        select(
          'Parent',
          'f-parent',
          [{id: '', name: 'None'}, ...s.resources.filter((x) => x.id !== o.id)],
          r.parent || '',
          'Placement only. A grant on the parent never covers the child. A parent with another owner is kept but cannot resolve.',
        ) +
        input('Path name', 'f-segment', r.segment, 'maxlength="60"') +
        yesNo('Audience', 'f-public', r.public)
    } else if (type === 'capability') {
      const g = {from: owner, to: 'bob', resource: scope, role: 'reader', ...o}
      html +=
        select('Resource', 'f-resource', s.resources, g.resource) +
        select(
          'Issued by',
          'f-from',
          s.keys,
          g.from,
          'Must hold admin on the resource. The proof is filled in from that admin grant.',
        ) +
        select('Granted to', 'f-to', s.keys, g.to) +
        select(
          'Role',
          'f-role',
          [
            {id: 'reader', name: 'Reader'},
            {id: 'writer', name: 'Writer (includes read)'},
            {id: 'admin', name: 'Admin (permanent, includes read and write)'},
          ],
          g.role,
        )
    } else if (type === 'revocation') {
      const targets = s.grants.filter((g) => g.role !== 'admin')
      const target = targets.find((g) => g.id === o.target) || targets[0]
      html +=
        select(
          'Grant to revoke',
          'f-target',
          targets.map((g) => ({
            id: g.id,
            name: `${g.id}: ${g.role} for ${ctx.name(g.to)} on ${ctx.resourceName(g.resource)}`,
          })),
          target?.id,
          'Admin grants are permanent and are not listed.',
        ) +
        select(
          'Signed by',
          'f-author',
          s.keys,
          o.author || ctx.res(target?.resource)?.owner || owner,
          'Must hold admin on the same resource.',
        )
    } else if (type === 'statement') {
      const kind = kinds.includes(o.kind) ? o.kind : 'snapshot'
      html +=
        select('Resource', 'f-resource', s.resources, scope) +
        select('Signed by', 'f-author', s.keys, o.author || owner, 'Only a current writer gets selected.') +
        select(
          'Kind',
          'f-kind',
          kinds.map((id) => ({id, name: id})),
          kind,
        ) +
        `<div id="kind-fields">${kindFields(kind, o, scope)}</div>`
    } else if (type === 'policy') {
      html +=
        select('Resource', 'f-resource', s.resources, o.id || scope) +
        yesNo('Audience', 'f-public', o.public ?? ctx.res(scope)?.public ?? false)
    }
    $('editor-fields').innerHTML = html + `<p class="note">Defined by ${schema}.</p>`
    if ($('blob-type'))
      $('blob-type').onchange = () => {
        editing.type = $('blob-type').value
        editing.o = {resource: $('f-resource')?.value || o.resource}
        render()
      }
    if ($('f-kind'))
      $('f-kind').onchange = () => {
        $('kind-fields').innerHTML = kindFields($('f-kind').value, o, $('f-resource').value)
      }
    if (type === 'revocation' && $('f-target'))
      $('f-target').onchange = () => {
        const g = s.grants.find((g) => g.id === $('f-target').value)
        if (g) $('f-author').value = ctx.res(g.resource)?.owner || $('f-author').value
      }
    if ((type === 'capability' || type === 'statement') && $('f-resource'))
      $('f-resource').onchange = () => {
        const field = $('f-from') || $('f-author')
        field.value = ctx.res($('f-resource').value)?.owner || field.value
      }
  }

  function kindFields(kind, o, scope) {
    const s = state()
    if (kind === 'snapshot') return input('Content', 'f-text', o.text ?? '', 'required maxlength="200"')
    if (kind === 'redirect')
      return select(
        'Redirect to',
        'f-target',
        s.resources.filter((r) => r.id !== scope),
        o.target,
        'A redirect points at another resource. It carries none of its permissions.',
      )
    return '<p class="note">A tombstone marks the resource as deleted. Earlier Refs and grants stay retained.</p>'
  }

  function read() {
    const v = (id) => $(id)?.value
    const {type, o} = editing
    if (type === 'key') return {name: v('f-name')?.trim(), note: o.note || ''}
    if (type === 'resource')
      return {
        name: v('f-name')?.trim(),
        owner: v('f-owner'),
        parent: v('f-parent') || null,
        segment: v('f-segment')?.trim() || '',
        public: v('f-public') === 'true',
        cid: o.cid,
      }
    if (type === 'capability') return {from: v('f-from'), to: v('f-to'), resource: v('f-resource'), role: v('f-role')}
    if (type === 'revocation') return {target: v('f-target'), author: v('f-author')}
    if (type === 'policy') return {resource: v('f-resource'), public: v('f-public') === 'true'}
    const kind = v('f-kind')
    const out = {resource: v('f-resource'), author: v('f-author'), seq: editing.exists ? o.seq : undefined}
    if (o.prev) out.prev = o.prev
    if (kind === 'snapshot') out.text = v('f-text')
    if (kind === 'redirect') out.target = v('f-target')
    return {kind, ...out}
  }

  $('object-form').onsubmit = async (e) => {
    e.preventDefault()
    const {type, o, exists, reissuing} = editing
    const data = read()
    const objectType = type === 'statement' ? data.kind : type
    const result = await ctx.api(
      {type: 'saveObject', objectType, id: exists || reissuing ? o.id : undefined, data},
      {quiet: true},
    )
    if (result.ok) {
      $('editor-dialog').close()
      ctx.afterAction(result)
    } else $('editor-error').textContent = result.error
  }
  for (const id of ['close-editor', 'cancel-editor']) $(id).onclick = () => $('editor-dialog').close()

  return {open}
}
