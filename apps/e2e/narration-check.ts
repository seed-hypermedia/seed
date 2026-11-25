/**
 * Headless check for narrated script effects: `ctx.call(tool, input, {description})`.
 *
 * The live gate can only observe this against a server running THIS branch; Eric's dev server runs
 * harness/01-verbs, which accepts the third argument but drops it before the journal. This drives
 * the workflow VM directly — no model, no server, no credentials — so the mechanism itself is gated
 * on every branch: the label must reach the durable journal entry AND the tool-call adapter, since
 * the UI reads the first and the run transcript reads the second.
 *
 * Run: bun e2e/narration-check.ts
 */
import {runWorkflowVM, type WorkflowAdapters, type WorkflowJournalEntry} from '../src/workflow-host'

const journal: WorkflowJournalEntry[] = []
const calls: Array<{tool: string; description?: string}> = []

const adapters: WorkflowAdapters = {
  runId: 'narration-check',
  input: null,
  source: `export default async function (input, ctx) {
    await ctx.call('write', {address: '~/memory/a.md', content: 'a'}, {description: 'Writing the first note'})
    await ctx.call('read', {address: '~/memory/a.md'}, {description: 'Reading it back'})
    await ctx.call('write', {address: '~/memory/b.md', content: 'b'})
    return {done: true}
  }`,
  journal: {
    load: () => [...journal],
    append: (entry) => {
      journal.push(entry)
    },
  },
  effects: {
    callTool: async (tool, _input, description) => {
      calls.push({tool, description})
      return {ok: true}
    },
    spawnAgent: () => ({childRunId: 'child-1'}),
    awaitChild: async () => ({status: 'succeeded', output: {text: 'done'}}),
    updatePlan: () => {},
    progress: () => {},
    registerEventWait: () => {},
  },
  isCanceled: () => false,
}

const outcome = await runWorkflowVM(adapters)
const callEntries = journal.filter((entry) => entry.kind === 'call') as Array<{
  kind: 'call'
  tool?: string
  description?: string
}>

const failures: string[] = []
const check = (condition: unknown, description: string) => {
  if (!condition) failures.push(description)
}

check(outcome.type === 'succeeded', `workflow succeeded (got ${JSON.stringify(outcome).slice(0, 160)})`)
check(callEntries.length === 3, `three call entries journaled (got ${callEntries.length})`)
check(
  callEntries[0]?.description === 'Writing the first note',
  `first journal entry keeps its label (got ${JSON.stringify(callEntries[0]?.description)})`,
)
check(
  callEntries[1]?.description === 'Reading it back',
  `second journal entry keeps its label (got ${JSON.stringify(callEntries[1]?.description)})`,
)
check(
  callEntries[2]?.description === undefined,
  `an unlabeled call stays unlabeled (got ${JSON.stringify(callEntries[2]?.description)})`,
)
check(
  calls[0]?.description === 'Writing the first note' && calls[1]?.description === 'Reading it back',
  `the label reaches the tool-call adapter (got ${JSON.stringify(calls.map((call) => call.description))})`,
)

if (failures.length === 0) {
  console.log(`narration-check PASS — labels: ${callEntries.map((entry) => entry.description ?? '—').join(' · ')}`)
  process.exit(0)
}
console.log('narration-check FAIL')
for (const failure of failures) console.log(`    ✗ ${failure}`)
process.exit(1)
