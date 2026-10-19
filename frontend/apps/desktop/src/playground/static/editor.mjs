import {escapeHTML as esc} from './ui.mjs'

const nodeKinds = ['snapshot', 'changes', 'changes-snapshot', 'tombstone', 'redirect', 'republish']

/**
 * The object editor: forms for every blob type, and immutable capability reissuance. It only
 * collects fields; the playground API validates and applies them.
 */
export function createObjectEditor(ctx) {
  const $ = (id) => document.getElementById(id)
  let editorContext = null
  const typeChoices = [
    ['resource', 'Resource · new identity + root policy'],
    ['key', 'Principal · simulated key'],
    ['snapshot', 'Node / snapshot'],
    ['changes', 'Node / changes'],
    ['changes-snapshot', 'Node / changes + utility snapshot'],
    ['tombstone', 'Node / tombstone'],
    ['redirect', 'Node / redirect'],
    ['republish', 'Node / republish placeholder'],
    ['change', 'Change · DAG operations'],
    ['capability', 'Capability · reader / writer / admin'],
    ['revocation', 'Revocation · exact capability'],
    ['policy', 'ResourcePolicy · audience'],
  ]
  const state = () => ctx.snapshot().state
  const derived = () => ctx.snapshot().derived
  const adminRoute = (actor, resource) => derived().adminRoute[actor]?.[resource] || ''
  const inputField = (label, id, value = '', help = '', extra = '') =>
    `<label>${label}<input id="${id}" name="${id}" value="${esc(value)}" ${extra}>${
      help ? `<small>${help}</small>` : ''
    }</label>`
  const selectField = (label, id, items, value, help = '') =>
    `<label>${label}<select id="${id}" name="${id}">${items
      .map((x) => `<option value="${esc(x.id)}" ${x.id === value ? 'selected' : ''}>${esc(x.name)}</option>`)
      .join('')}</select>${help ? `<small>${help}</small>` : ''}</label>`
  const jsonField = (label, id, value, help = '') =>
    `<label class="full">${label}<textarea id="${id}" name="${id}" rows="5" spellcheck="false">${esc(
      JSON.stringify(value, null, 2),
    )}</textarea>${help ? `<small>${help}</small>` : ''}</label>`

  function openEditor(type, o = {}) {
    if (type === 'statement') type = o.kind
    if (type === 'grant') type = 'capability'
    const s = state()
    const reissuing = type === 'capability' && !!o.id && s.grants.some((g) => g.id === o.id)
    const inGroup = (list) => list.some((x) => x.id === o.id)
    const editing =
      !reissuing &&
      !!o.id &&
      (type === 'policy' ||
        inGroup(s.resources) ||
        inGroup(s.keys) ||
        inGroup(s.statements) ||
        inGroup(s.changes) ||
        inGroup(s.revocations))
    editorContext = {type, o: structuredClone(o), editing, reissuing}
    renderEditor()
    $('editor-dialog').showModal()
  }

  function renderEditor() {
    const {type, o, editing, reissuing} = editorContext
    const s = state()
    const scope =
      o.resource ||
      (ctx.selection.type === 'resource' ? ctx.selection.id : ctx.selectedRecord()?.resource) ||
      s.resources[0].id
    const resource = ctx.res(scope) || s.resources[0]
    const owner = resource.owner
    $('editor-title').textContent =
      (reissuing ? 'Reissue ' : editing ? 'Edit ' : 'Add ') +
      (type === 'capability' ? 'capability' : type === 'policy' ? 'resource policy' : type)
    $('save-object').textContent = reissuing ? 'Issue new capability' : editing ? 'Save changes' : 'Add to experiment'
    $('editor-error').textContent = ''
    let fields = selectField(
      'WHAT WOULD YOU LIKE TO MAKE?',
      'blob-type',
      typeChoices.map(([id, name]) => ({id, name})),
      type,
      'Choose a blob type. Forms show only the fields that apply.',
    )
    if (editing)
      fields =
        `<div class="editing-identity">Editing <b>${esc(
          o.id,
        )}</b> · fixture changes keep this simulated ID. Real edits would create new signed blobs.</div>` +
        (nodeKinds.includes(type)
          ? selectField(
              'NODE KIND',
              'blob-type',
              nodeKinds.map((id) => ({id, name: id})),
              type,
            )
          : '')
    if (reissuing)
      fields = `<div class="reissue-notice"><b>Original ${esc(
        o.id,
      )} stays immutable.</b><p>You are issuing a new grant with a new ID. The old grant is not overwritten or automatically revoked.</p></div>`
    fields += '<div class="form-grid">'
    if (type === 'key')
      fields +=
        inputField('DISPLAY NAME', 'f-name', o.name || '', '', 'required maxlength="60"') +
        inputField('DESCRIPTION', 'f-note', o.note || 'Simulated key')
    else if (type === 'resource') {
      const r = {owner: 'alice', parent: null, segment: '', public: false, ...o}
      fields +=
        inputField(
          'DISPLAY LABEL',
          'f-name',
          r.name || '',
          'Human-friendly label; independent of the optional path name.',
          'required maxlength="60"',
        ) +
        selectField(
          'OWNER / TRUSTED ROOT KEY',
          'f-owner',
          s.keys,
          r.owner,
          'Root anchor for this resource. A change re-anchors its placement subtree; older proofs may become invalid.',
        ) +
        selectField(
          'PARENT RESOURCE (OPTIONAL)',
          'f-parent',
          [{id: '', name: 'None · root namespace'}, ...s.resources.filter((x) => x.id !== o.id)],
          r.parent || '',
          'Placement never confers access.',
        ) +
        inputField(
          'PATH NAME (OPTIONAL)',
          'f-segment',
          r.segment,
          'One unique name per sibling group in the same owner namespace. Blank means address by CID.',
          'maxlength="60"',
        ) +
        selectField(
          'CONTENT AUDIENCE',
          'f-public',
          [
            {id: 'false', name: 'Private · explicit grants required'},
            {id: 'true', name: 'Public content · private membership'},
          ],
          String(r.public),
        )
      if (editing)
        fields += inputField(
          'ORIGINAL NODE CID (SIMULATED)',
          'f-cid',
          r.cid,
          'Changing this fixture label keeps its internal resource associations.',
          'required',
        )
      fields +=
        '<p class="full muted">Unique sibling names and acyclic placement are lab conventions. The draft leaves name-conflict and resolution rules open.</p>'
    } else if (type === 'capability') {
      const g = {from: owner, to: 'bob', resource: scope, role: 'reader', ...o}
      fields +=
        selectField('ISSUING KEY', 'f-from', s.keys, g.from) +
        selectField('RECIPIENT KEY', 'f-to', s.keys, g.to) +
        selectField('EXACT RESOURCE', 'f-resource', s.resources, g.resource) +
        selectField(
          'ROLE',
          'f-role',
          [
            {id: 'reader', name: 'Reader'},
            {id: 'writer', name: 'Writer · includes read'},
            {id: 'admin', name: 'Irrevocable admin · includes read/write'},
          ],
          g.role,
        ) +
        inputField(
          'PERMANENT ADMIN PROOF ID',
          'f-proof',
          g.proof ?? adminRoute(g.from, g.resource),
          'Use a same-scope admin grant held by the issuer. Empty is valid only for the owner’s self-admin anchor.',
        )
    } else if (type === 'revocation') {
      const g = s.grants.find((g) => g.id === o.target) || s.grants.find((g) => g.role !== 'admin') || s.grants[0]
      fields +=
        selectField(
          'EXACT CAPABILITY TO REVOKE',
          'f-target',
          s.grants.map((g) => ({
            id: g.id,
            name: g.id + ' / ' + g.role + ' / ' + ctx.name(g.to) + ' / ' + ctx.resourceName(g.resource),
          })),
          o.target || g?.id,
        ) +
        selectField('SIGNING KEY', 'f-author', s.keys, o.author || owner) +
        selectField('EXACT RESOURCE', 'f-resource', s.resources, o.resource || g?.resource || scope) +
        inputField(
          'PERMANENT ADMIN PROOF ID',
          'f-proof',
          o.proof || adminRoute(o.author || owner, o.resource || g?.resource || scope),
          'Invalid or permanent-admin revocations are retained as invalid evidence and confer no effect.',
          'required',
        )
    } else if (type === 'policy') {
      fields +=
        selectField('RESOURCE', 'f-resource', s.resources, o.id || scope) +
        selectField(
          'CONTENT AUDIENCE',
          'f-public',
          [
            {id: 'false', name: 'Private'},
            {id: 'true', name: 'Public content'},
          ],
          String(o.public ?? resource.public),
        )
      fields +=
        '<p class="full muted">The resource owner signs this synthetic root-policy fact. Already disclosed bytes are not erased.</p>'
    } else {
      fields +=
        selectField(
          'ASSOCIATED RESOURCE',
          'f-resource',
          s.resources,
          scope,
          'Association is scoped; an ordinary CID reference never grants access.',
        ) + selectField('SIGNING KEY', 'f-author', s.keys, o.author || owner)
      if (type === 'change') {
        fields +=
          inputField(
            'DEPENDENCY CHANGE IDS',
            'f-deps',
            (o.deps || []).join(', '),
            'Comma-separated. Empty creates a root change; unresolved dependencies remain missing.',
          ) +
          jsonField(
            'ORDERED OPERATIONS (JSON ARRAY)',
            'f-ops',
            o.ops || [{op: 'set', key: 'title', value: 'Field notes'}],
            'Operations remain generic data; this lab does not invent an apply runtime.',
          )
      } else {
        fields += inputField(
          'SELECTION SEQUENCE (SIMULATED TS)',
          'f-seq',
          o.seq ?? Math.max(0, ...s.statements.map((v) => v.seq)) + 1,
          'Highest sequence from a currently authorized author wins. Sequence ties break by retained order in this lab.',
          'type="number" min="0" step="1" required',
        )
        if (['snapshot', 'tombstone', 'redirect'].includes(type))
          fields += inputField(
            'PREVIOUS STATEMENT ID (OPTIONAL)',
            'f-prev',
            o.prev || '',
            'A history breadcrumb, never authority.',
          )
        if (type === 'snapshot')
          fields += jsonField('AUTHORITATIVE STATE (JSON)', 'f-state', o.state ?? o.text ?? {title: 'New snapshot'})
        if (type === 'redirect')
          fields += selectField(
            'REDIRECT TARGET RESOURCE',
            'f-target',
            s.resources,
            o.target || s.resources.find((r) => r.id !== scope)?.id || scope,
            'A target is an identity reference. It does not carry this resource’s permissions. Native resolution is still an open design question.',
          )
        if (type === 'tombstone')
          fields +=
            '<div class="variant-explainer full"><b>Tombstone</b><p>Publishes a tombstone statement for this identity. The lab shows a tombstoned rendition when it is selected. Previous statements, grants and cached bytes remain inspectable. Native revival rules are still open.</p></div>'
        if (['changes', 'changes-snapshot'].includes(type))
          fields +=
            inputField(
              'HEAD CHANGE IDS',
              'f-heads',
              (o.heads || [s.changes.find((c) => c.resource === scope)?.id || 'missing-change']).join(', '),
              'One or more comma-separated IDs. Missing named dependencies keep materialization incomplete.',
              'required',
            ) +
            inputField(
              'EXACT APPLY FUNCTION ID',
              'f-apply',
              o.apply || 'bafy-apply-demo',
              'Immutable function reference. Runtime execution is outside this simulator.',
              'required',
            )
        if (type === 'changes-snapshot')
          fields += jsonField(
            'UTILITY SNAPSHOT (JSON)',
            'f-snapshot',
            o.snapshot ?? {title: 'Provisional rendition'},
            'An accelerator only; never authoritative over the change DAG.',
          )
        if (type === 'republish')
          fields +=
            '<div class="variant-explainer full"><b>BaseNode-only placeholder</b><p>The closed draft has no payload, target or prev for republish. You can create and inspect the placeholder; its behavior is shown as unsupported.</p></div>'
      }
    }
    fields += '</div>'
    $('editor-fields').innerHTML = fields
    if ($('f-proof')) {
      const hints = document.createElement('datalist')
      hints.id = 'proof-options'
      hints.innerHTML = s.grants
        .filter((g) => g.role === 'admin')
        .map(
          (g) => `<option value="${esc(g.id)}">${esc(ctx.name(g.to))} / ${esc(ctx.resourceName(g.resource))}</option>`,
        )
        .join('')
      $('f-proof').after(hints)
      $('f-proof').setAttribute('list', 'proof-options')
    }
    const suggestProof = () => {
      if (!$('f-proof')) return
      const actor = $('f-from')?.value || $('f-author')?.value
      const r = $('f-resource')?.value
      $('f-proof').value = adminRoute(actor, r)
    }
    if ($('f-from')) $('f-from').onchange = suggestProof
    if ($('f-resource'))
      $('f-resource').onchange = () => {
        if ($('f-author') && type !== 'revocation') $('f-author').value = ctx.res($('f-resource').value).owner
        suggestProof()
      }
    if (type === 'revocation' && $('f-target'))
      $('f-target').onchange = () => {
        const g = s.grants.find((g) => g.id === $('f-target').value)
        if (g) {
          $('f-resource').value = g.resource
          $('f-author').value = ctx.res(g.resource).owner
          suggestProof()
        }
      }
    if (type === 'revocation' && $('f-author')) $('f-author').onchange = suggestProof
    if ($('blob-type'))
      $('blob-type').onchange = () => {
        const next = $('blob-type').value
        const current = readEditor()
        editorContext.type = next
        editorContext.o = {...editorContext.o, ...current}
        renderEditor()
      }
  }

  /** Collect the form as the API expects it. JSON fields stay text; the API parses and validates them. */
  function readEditor() {
    const val = (id) => $(id)?.value
    const type = editorContext.type
    const o = {}
    if (type === 'key') {
      o.name = val('f-name')?.trim()
      o.note = val('f-note') || ''
    } else if (type === 'resource') {
      Object.assign(o, {
        name: val('f-name')?.trim(),
        owner: val('f-owner'),
        parent: val('f-parent') || null,
        segment: val('f-segment')?.trim() || '',
        public: val('f-public') === 'true',
      })
      if (val('f-cid')) o.cid = val('f-cid').trim()
    } else if (type === 'capability')
      Object.assign(o, {
        from: val('f-from'),
        to: val('f-to'),
        resource: val('f-resource'),
        role: val('f-role'),
        proof: val('f-proof')?.trim() || null,
      })
    else if (type === 'policy') Object.assign(o, {resource: val('f-resource'), public: val('f-public') === 'true'})
    else {
      Object.assign(o, {resource: val('f-resource'), author: val('f-author')})
      if (type === 'revocation') Object.assign(o, {target: val('f-target'), proof: val('f-proof')?.trim() || ''})
      else if (type === 'change') {
        o.deps = val('f-deps') || ''
        o.ops = val('f-ops')
      } else {
        Object.assign(o, {kind: type, seq: Number(val('f-seq'))})
        if (val('f-prev')?.trim()) o.prev = val('f-prev').trim()
        if (type === 'snapshot') o.state = val('f-state')
        if (type === 'redirect') o.target = val('f-target')
        if (['changes', 'changes-snapshot'].includes(type))
          Object.assign(o, {heads: val('f-heads') || '', apply: val('f-apply')?.trim()})
        if (type === 'changes-snapshot') o.snapshot = val('f-snapshot')
      }
    }
    return o
  }

  $('object-form').onsubmit = async (e) => {
    e.preventDefault()
    const {type, o, editing, reissuing} = editorContext
    const data = readEditor()
    const result = await ctx.api(
      {type: 'saveObject', objectType: type, id: editing || reissuing ? o.id : undefined, data},
      {quiet: true},
    )
    if (result.ok) {
      $('editor-dialog').close()
      ctx.afterAction(result)
    } else {
      $('editor-error').textContent = result.error
    }
  }
  for (const id of ['close-editor', 'cancel-editor']) $(id).onclick = () => $('editor-dialog').close()
  $('add-key').onclick = () => openEditor('key')
  $('add-resource').onclick = () => openEditor('resource')
  $('add-blob').onclick = () =>
    openEditor('snapshot', {
      resource: ctx.selection.type === 'resource' ? ctx.selection.id : ctx.selectedRecord()?.resource,
    })

  return {open: openEditor}
}
