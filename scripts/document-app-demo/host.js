import {mountApp} from './bridge.js'
import {runChecks} from './checks.js'

const $ = (id) => document.getElementById(id)
let config,
  apps = [],
  selected,
  sessions = [],
  generation,
  requestCount = 0
const grants = new Set()
const grantKey = () => JSON.stringify([$('viewer').value, selected.id, selected.revision])

function record(event) {
  if (event.type !== 'request') return
  const row = document.createElement('li')
  row.textContent = `${event.method} — ${event.error || 'allowed'}`
  if (event.error) row.className = 'failed'
  $('activity-log').prepend(row)
  while ($('activity-log').children.length > 100) $('activity-log').lastElementChild.remove()
  $('activity-count').textContent = `${++requestCount} requests`
}

function render() {
  for (const session of sessions) session.destroy()
  sessions = []
  $('runtime-error').textContent = ''
  $('app-title').textContent = selected.title
  $('app-description').textContent = selected.description
  $('provenance').textContent = `Created by ${selected.provenance}`
  const viewer = $('viewer').value
  $('grant').checked = grants.has(grantKey())
  $('grant').disabled = !viewer
  $('signed-out').hidden = !!viewer
  $('frames').hidden = !viewer
  $('copy-frame').hidden = !$('duplicate').checked
  $('runtime-status').textContent = viewer ? 'Starting' : 'Signed out'
  $('storage-label').textContent = viewer ? `${viewer}’s storage · isolated per app` : 'App sessions closed'
  if (!viewer) return
  const session = mountApp({
    container: $('app-frame'),
    runnerOrigin: config.runnerOrigin,
    artifact: selected,
    viewer,
    grants: $('grant').checked ? ['project-brief'] : [],
    resource: async () => ({
      title: `${viewer}’s project brief`,
      text:
        viewer === 'Alice'
          ? 'Make a tiny garden journal. Plant rosemary and thyme this weekend.'
          : 'Design a reading nook. Find a lamp and choose three books for autumn.',
    }),
    onEvent: (event) => {
      record(event)
      if (event.type === 'closed' && sessions.includes(session)) {
        $('runtime-status').textContent = 'Stopped'
        $('runtime-error').textContent = `${event.reason}. Reload the app to start a new session.`
      }
    },
  })
  sessions.push(session)
  session.ready
    .then(() => {
      if (sessions.includes(session)) $('runtime-status').textContent = 'Sandbox active'
    })
    .catch((error) => {
      if (sessions.includes(session)) {
        $('runtime-error').textContent = error.message
        $('runtime-status').textContent = 'Stopped'
      }
    })
  if ($('duplicate').checked) {
    const copy = mountApp({
      container: $('copy-frame'),
      runnerOrigin: config.runnerOrigin,
      artifact: {...selected, id: `${selected.id}:copy`, title: `${selected.title} · separate copy`},
      viewer,
      onEvent: record,
    })
    sessions.push(copy)
    copy.ready.catch((error) => {
      if (sessions.includes(copy)) $('runtime-error').textContent = error.message
    })
  }
}

function options() {
  $('app-select').replaceChildren(
    ...apps.map((app) => {
      const option = document.createElement('option')
      option.value = app.id
      option.textContent = app.title
      return option
    }),
  )
  $('app-select').value = selected.id
}

$('app-select').addEventListener('change', () => {
  selected = apps.find((app) => app.id === $('app-select').value)
  render()
})
$('viewer').addEventListener('change', render)
$('duplicate').addEventListener('change', render)
$('reload').addEventListener('click', render)
$('grant').addEventListener('change', () => {
  if ($('grant').checked) grants.add(grantKey())
  else grants.delete(grantKey())
  render()
})
$('update-code').addEventListener('click', async () => {
  const original = selected
  $('update-code').disabled = true
  $('runtime-status').textContent = 'Updating'
  const html = `${original.html}\n<!-- Demo code update ${crypto.randomUUID()} -->`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  $('update-code').disabled = false
  if (selected !== original) return
  selected = {
    ...original,
    html,
    revision: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
  }
  apps = apps.map((app) => (app.id === selected.id ? selected : app))
  render()
})
$('cancel').addEventListener('click', () => generation?.abort())
$('generate').addEventListener('click', async () => {
  if (!$('prompt').value.trim()) {
    $('generation-status').textContent = 'Describe an app first.'
    return
  }
  $('generate').disabled = true
  $('cancel').hidden = false
  $('generation-status').textContent = 'The agent is writing your app. You can keep using the preview.'
  generation = new AbortController()
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Seed-Demo-Token': config.csrf},
      body: JSON.stringify({prompt: $('prompt').value}),
      signal: generation.signal,
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    selected = result
    apps.push(result)
    options()
    render()
    $('generation-status').textContent = 'Your app is ready. Its code runs inside the sandbox.'
  } catch (error) {
    $('generation-status').textContent = error.name === 'AbortError' ? 'Creation cancelled.' : error.message
  } finally {
    $('generate').disabled = false
    $('cancel').hidden = true
    generation = null
  }
})
$('run-checks').addEventListener('click', async () => {
  $('run-checks').disabled = true
  $('check-results').replaceChildren()
  try {
    await runChecks(config.runnerOrigin, (result) => {
      const row = document.createElement('li')
      row.textContent = `${result.pass ? '✓' : '✕'} ${result.name}`
      if (!result.pass) row.className = 'failed'
      $('check-results').append(row)
    })
  } catch (error) {
    const row = document.createElement('li')
    row.textContent = error.message
    row.className = 'failed'
    $('check-results').append(row)
  } finally {
    $('run-checks').disabled = false
  }
})

try {
  ;[config, apps] = await Promise.all(
    ['/api/config', '/api/apps'].map(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Demo could not load ${url}`)
      return response.json()
    }),
  )
  selected = apps[0]
  options()
  render()
} catch (error) {
  $('runtime-error').textContent = error.message
  $('generate').disabled = true
}
