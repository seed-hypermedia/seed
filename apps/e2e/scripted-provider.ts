/**
 * A scripted OpenAI-compatible provider, so a REAL running Agents server can be driven through a
 * REAL HTTP request/response cycle with a deterministic "model".
 *
 * The live gate proper needs a live model; this is the other half of the same question — does the
 * runtime behave in the real process, over real sockets, against real sqlite — with the model's
 * half of the conversation pinned so the answer is about the runtime and nothing else.
 */
const PORT = Number(process.env.PORT || 4099)
/** Where the provider writes what it saw, so the live check can assert on the REQUESTS too. */
const OBSERVATIONS = process.env.OBSERVATIONS || '/tmp/scripted-provider-observations.json'

const usage = () => ({prompt_tokens: 11, completion_tokens: 7, total_tokens: 18})

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })

const say = (id: string, content: string) =>
  sse([
    {id, choices: [{delta: {content}}]},
    {id, choices: [{delta: {}, finish_reason: 'stop'}], usage: usage()},
  ])

const planCall = (id: string, steps: Array<[string, string, string]>) =>
  sse([
    {
      id,
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `plan-${id}`,
                type: 'function',
                function: {
                  name: 'plan',
                  arguments: JSON.stringify({
                    title: 'Colors',
                    steps: steps.map(([stepId, label, status]) => ({id: stepId, label, status})),
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    {id, choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: usage()},
  ])

const planAndDelegate = (id: string) =>
  sse([
    {
      id,
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `plan-${id}`,
                type: 'function',
                function: {
                  name: 'plan',
                  arguments: JSON.stringify({
                    title: 'Colors',
                    steps: [
                      {id: 's1', label: 'Research the colors', status: 'running'},
                      {id: 's2', label: 'Write the sentence', status: 'pending'},
                    ],
                  }),
                },
              },
              {
                index: 1,
                id: `spawn-${id}`,
                type: 'function',
                function: {
                  name: 'delegate',
                  arguments: JSON.stringify({
                    title: 'Researcher',
                    brief: 'Name three colors',
                    prompt: 'You are the researcher.',
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    {id, choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: usage()},
  ])

let calls = 0
let parentTurns = 0
const observations: {parentTurns: Array<{turn: number; planState: string | null}>} = {parentTurns: []}
Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (!url.pathname.endsWith('/chat/completions')) return Response.json({data: []})
    const body = (await req.json()) as {messages: Array<{role: string; content: unknown}>}
    const transcript = JSON.stringify(body.messages)
    calls += 1
    console.log(`[scripted] call ${calls}`)

    // MODE=delegation: Eric's shape. The parent publishes a checklist, delegates the first step, and
    // when it is resumed it NEVER touches that step — the whole question is whether the runtime has
    // already closed it from the child's success, leaving nothing to be nudged about.
    if (process.env.MODE === 'delegation') {
      const isParent = body.messages.some(
        (message) => message.role === 'system' && String(message.content ?? '').includes('You keep a plan.'),
      )
      if (!isParent) return say('child', 'Red, blue and green.')
      parentTurns += 1
      // The injected checklist never reaches the log, so the provider request is the only place it
      // can be observed at all.
      const planState = body.messages
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .find((content) => content.includes('<plan_state>'))
      observations.parentTurns.push({turn: parentTurns, planState: planState ?? null})
      Bun.write(OBSERVATIONS, JSON.stringify(observations, null, 2))
      if (parentTurns === 1) return planAndDelegate('d1')
      // Resumed after the child. It closes its OWN remaining step and says nothing about the
      // delegated one.
      if (parentTurns === 2) {
        return planCall('d2', [
          ['s1', 'Research the colors', 'done'],
          ['s2', 'Write the sentence', 'done'],
        ])
      }
      return say(`d${parentTurns}`, 'The red kite flew past a blue door onto green grass.')
    }
    // 1: publish a two-step plan, leaving the second open. 2: answer as if finished — the live bug
    // Eric hit. 3+: only reachable if the runtime hands the turn back; close the plan honestly.
    if (calls === 1) {
      return planCall('t1', [
        ['s1', 'Name three colors', 'done'],
        ['s2', 'Write the sentence', 'pending'],
      ])
    }
    if (calls === 2) return say('t2', 'Red, blue and green — the red kite flew past a blue door onto green grass.')
    if (
      process.env.MODE !== 'stubborn' &&
      transcript.includes('This turn is ending with work you committed to still open') &&
      calls === 3
    ) {
      return planCall('t3', [
        ['s1', 'Name three colors', 'done'],
        ['s2', 'Write the sentence', 'done'],
      ])
    }
    // MODE=stubborn: never close the step, whatever it is asked — the run must end honestly rather
    // than tick the box itself.
    return say(`t${calls}`, process.env.MODE === 'stubborn' ? 'Anything else?' : 'Both steps are closed out.')
  },
})
console.log(`scripted provider on http://127.0.0.1:${PORT}/v1`)
