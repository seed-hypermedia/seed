export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KM Observability Center</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #f4efe5;
      --muted: #9e9584;
      --panel: rgba(18, 21, 20, 0.78);
      --panel-strong: rgba(28, 32, 30, 0.92);
      --line: rgba(244, 239, 229, 0.14);
      --acid: #d6ff3f;
      --amber: #ffb84d;
      --bad: #ff6b5f;
      --blue: #78d8ff;
      --bg: #0b0d0c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-monospace, "SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace;
      background:
        radial-gradient(circle at 12% 8%, rgba(214,255,63,0.14), transparent 28rem),
        radial-gradient(circle at 86% 18%, rgba(120,216,255,0.12), transparent 26rem),
        linear-gradient(135deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 18px),
        var(--bg);
      color: var(--ink);
    }
    body:before {
      content: "";
      position: fixed; inset: 0; pointer-events: none; opacity: .16;
      background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,.08) 3px, transparent 4px);
      mix-blend-mode: overlay;
    }
    header { padding: 32px clamp(18px, 4vw, 52px) 14px; display: flex; justify-content: space-between; gap: 24px; align-items: end; }
    h1 { margin: 0; font-size: clamp(32px, 7vw, 82px); letter-spacing: -.08em; line-height: .84; max-width: 900px; text-transform: uppercase; }
    .tag { color: var(--acid); border: 1px solid var(--acid); border-radius: 999px; padding: 8px 12px; white-space: nowrap; box-shadow: 0 0 26px rgba(214,255,63,.18); }
    main { padding: 18px clamp(18px, 4vw, 52px) 44px; display: grid; gap: 16px; grid-template-columns: 1.1fr .9fr; }
    .strip { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 22px; padding: 18px; backdrop-filter: blur(18px); box-shadow: 0 24px 80px rgba(0,0,0,.38); }
    .metric .label, label, .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .16em; font-size: 11px; }
    .metric .value { font-size: clamp(26px, 5vw, 54px); letter-spacing: -.07em; margin-top: 10px; }
    .metric small { color: var(--muted); }
    .panel-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    h2 { margin: 0; font-size: 18px; letter-spacing: -.04em; }
    input, select, button { font: inherit; }
    input { width: 100%; background: rgba(0,0,0,.36); border: 1px solid var(--line); color: var(--ink); border-radius: 14px; padding: 12px 14px; outline: none; }
    input:focus { border-color: var(--acid); box-shadow: 0 0 0 3px rgba(214,255,63,.09); }
    button { border: 1px solid var(--acid); background: var(--acid); color: #14160e; border-radius: 14px; padding: 11px 14px; cursor: pointer; font-weight: 800; }
    button.ghost { background: transparent; color: var(--acid); }
    .query { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 12px; }
    .timeline { display: grid; gap: 10px; max-height: 64vh; overflow: auto; padding-right: 4px; }
    .event { display: grid; grid-template-columns: 120px 1fr; gap: 12px; padding: 12px; background: rgba(255,255,255,.035); border: 1px solid var(--line); border-radius: 16px; }
    .event .time { color: var(--muted); font-size: 11px; }
    .event .name { color: var(--blue); font-weight: 800; }
    .event.trace .name { color: var(--acid); }
    .event.machine_event .name, .event.machine_snapshot .name { color: var(--amber); }
    .event.error, .event.warn { border-color: rgba(255,107,95,.34); }
    .preview { color: var(--ink); opacity: .88; margin-top: 6px; line-height: 1.4; word-break: break-word; }
    .meta { color: var(--muted); margin-top: 8px; font-size: 11px; display: flex; flex-wrap: wrap; gap: 8px; }
    .runs { display: grid; gap: 10px; max-height: 34vh; overflow: auto; }
    .run { padding: 12px; border-radius: 15px; border: 1px solid var(--line); background: rgba(0,0,0,.24); cursor: pointer; }
    .run:hover { border-color: rgba(214,255,63,.46); }
    .run code { color: var(--acid); }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: var(--muted); font-size: 12px; }
    @media (max-width: 900px) { main, .strip { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; } }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="eyebrow">oc.hyper.media / backend daemon first</div>
      <h1>KM operations radar</h1>
    </div>
    <div class="tag" id="connection">connecting</div>
  </header>
  <main>
    <section class="strip">
      <div class="card metric"><div class="label">alive actors</div><div class="value" id="aliveActors">—</div><small>machines not terminal</small></div>
      <div class="card metric"><div class="label">active runs</div><div class="value" id="activeRuns">—</div><small>runs without an end</small></div>
      <div class="card metric"><div class="label">events loaded</div><div class="value" id="eventCount">—</div><small>current view</small></div>
      <div class="card metric"><div class="label">last update</div><div class="value" id="lastUpdate" style="font-size:28px">—</div><small>server clock</small></div>
    </section>
    <section class="card">
      <div class="panel-title"><h2>Ask by comment link / id</h2><button class="ghost" id="clearBtn">clear</button></div>
      <div class="query"><input id="commentInput" placeholder="paste comment URL, hm://… link, or author/tsid" /><button id="timelineBtn">trace</button></div>
      <div class="timeline" id="events"></div>
    </section>
    <aside class="card">
      <div class="panel-title"><h2>Recent KM runs</h2><button class="ghost" id="refreshBtn">refresh</button></div>
      <div class="runs" id="runs"></div>
      <div class="panel-title" style="margin-top:18px"><h2>Selected payload</h2></div>
      <pre id="payload">click an event to inspect payload</pre>
    </aside>
  </main>
<script>
const $ = (id) => document.getElementById(id)
let currentEvents = []
function extractCommentId(raw) {
  const value = raw.trim()
  if (!value) return ''
  const hm = value.match(/hm:\/\/[^\s)]+(?:\/comment\/|[?#&]comment=)([^\s&#)]+)/i)
  if (hm) return decodeURIComponent(hm[1])
  const url = value.match(/(?:commentId|comment|id)=([^&#\s]+)/i)
  if (url) return decodeURIComponent(url[1])
  const slash = value.match(/[A-Za-z0-9_-]{12,}\/[A-Za-z0-9_-]{6,}/)
  return slash ? slash[0] : value
}
function fmtTime(ts) { try { return new Date(ts).toLocaleString() } catch { return ts || '—' } }
function compact(ts) { try { return new Date(ts).toLocaleTimeString() } catch { return '—' } }
async function json(path) { const r = await fetch(path); if (!r.ok) throw new Error(await r.text()); return r.json() }
function eventHtml(e) {
  const cls = [e.kind, e.level].filter(Boolean).join(' ')
  return '<div class="event '+cls+'" data-id="'+e.id+'"><div class="time">'+compact(e.ts)+'<br>'+e.kind+'</div><div><div class="name">'+(e.eventName||e.kind)+'</div><div class="preview">'+escapeHtml(e.preview||'')+'</div><div class="meta">'+[
    e.commentId && 'comment '+e.commentId, e.actorId && 'actor '+e.actorId, e.state && 'state '+e.state, e.status && 'status '+e.status
  ].filter(Boolean).map(escapeHtml).join('<span>•</span>')+'</div></div></div>'
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
function renderEvents(events) {
  currentEvents = events
  $('eventCount').textContent = String(events.length)
  $('events').innerHTML = events.map(eventHtml).join('') || '<div class="event"><div></div><div>No events yet.</div></div>'
}
function renderRuns(runs) {
  $('runs').innerHTML = runs.map(r => '<div class="run" data-run="'+r.runId+'"><code>'+r.runId+'</code><div>'+escapeHtml(r.trigger||'run')+' · '+escapeHtml(r.status||'active')+'</div><div class="meta">'+escapeHtml(fmtTime(r.startedAt))+' · '+(r.wallMs ? Math.round(r.wallMs/1000)+'s' : 'open')+'</div></div>').join('') || '<div class="run">No runs.</div>'
}
async function refresh() {
  const [live, runs] = await Promise.all([json('/api/live'), json('/api/runs')])
  $('aliveActors').textContent = live.aliveActors
  $('activeRuns').textContent = live.activeRuns
  $('lastUpdate').textContent = compact(live.updatedAt)
  renderEvents(live.latestEvents)
  renderRuns(runs.runs)
}
$('timelineBtn').onclick = async () => {
  const id = extractCommentId($('commentInput').value)
  if (!id) return refresh()
  const data = await json('/api/comments/' + encodeURIComponent(id) + '/timeline')
  renderEvents(data.events)
}
$('clearBtn').onclick = () => { $('commentInput').value = ''; refresh() }
$('refreshBtn').onclick = refresh
$('events').onclick = (ev) => {
  const card = ev.target.closest('.event')
  if (!card) return
  const e = currentEvents.find(x => String(x.id) === card.dataset.id)
  $('payload').textContent = e ? JSON.stringify(JSON.parse(e.payloadJson || '{}'), null, 2) : 'no payload'
}
$('runs').onclick = async (ev) => {
  const card = ev.target.closest('.run')
  if (!card?.dataset.run) return
  const data = await json('/api/events?runId=' + encodeURIComponent(card.dataset.run))
  renderEvents(data.events)
}
try {
  const stream = new EventSource('/api/stream')
  stream.onopen = () => $('connection').textContent = 'live'
  stream.onerror = () => $('connection').textContent = 'reconnecting'
  stream.addEventListener('summary', (ev) => {
    const live = JSON.parse(ev.data)
    $('aliveActors').textContent = live.aliveActors
    $('activeRuns').textContent = live.activeRuns
    $('lastUpdate').textContent = compact(live.updatedAt)
  })
  stream.addEventListener('event', () => refresh())
} catch { $('connection').textContent = 'polling' }
refresh().catch(err => { $('connection').textContent = err.message })
</script>
</body>
</html>`
}
