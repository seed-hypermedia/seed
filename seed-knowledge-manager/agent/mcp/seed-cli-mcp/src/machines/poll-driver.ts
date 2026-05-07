/**
 * Glue between poll-cli's PASS B and the per-mention XState supervisor.
 *
 * For each pending placeholder, spawn a machine, supply callbacks that run
 * the existing reply-engine.draftReply (or Mastra agent when configured),
 * and wait for the machine to reach a terminal state.
 */

import type {AuditRun} from '../audit.js'
import type {AgentConfig} from '../config.js'
import type {SeedCli} from '../seedcli.js'
import type {State, PlaceholderRecord} from '../state.js'
import {draftReply, gatherCommentReplyContext} from '../reply-engine.js'
import {MentionSupervisor} from './supervisor.js'

export type RunMachinePassBOptions = {
  config: AgentConfig
  cli: SeedCli
  state: State
  audit: AuditRun
  pending: PlaceholderRecord[]
  siteAccount: string
  fallbackBody: string
}

export async function runMachinePassB(opts: RunMachinePassBOptions): Promise<{finalised: number; errored: number}> {
  const {config, cli, state, audit, pending, siteAccount, fallbackBody} = opts
  let finalised = 0
  let errored = 0

  const supervisor = new MentionSupervisor(config.stateDir, {
    // Placeholder is already posted in Pass A; the machine starts straight at
    // `placeholder_posted` by sending POST_PLACEHOLDER + PLACEHOLDER_POSTED in
    // sequence below.
    postPlaceholder: async () => ({placeholderId: ''}),
    runAgent: async (mention) => {
      const question = mention.text.replace(/￼/g, ' ').trim()
      const context = await gatherCommentReplyContext({cli, mention, siteAccount, audit})
      if (config.useMastraAgent) {
        const {runMastraReply} = await import('../agent/mastra-agent.js')
        const reply = await runMastraReply({question, context, mention, audit, cli})
        return {replyBody: reply ?? fallbackBody}
      }
      const reply = await draftReply(question, context, audit)
      return {replyBody: reply ?? fallbackBody}
    },
    finaliseComment: async (placeholderId, replyBody) => {
      const r = await cli.runWrite(['comment', 'edit', placeholderId, '--body', replyBody])
      if (r.exitCode !== 0) {
        throw new Error(`comment edit failed: exit=${r.exitCode} stderr=${r.stderr.slice(0, 200)}`)
      }
    },
  })

  // Replay any actors persisted from prior runs so we resume mid-flight.
  const replay = supervisor.rehydrate()
  if (replay.restored > 0) {
    audit.trace({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'state_machine_rehydrated',
      data: replay,
    })
  }

  for (const rec of pending) {
    const actor = supervisor.spawn(rec.mention)
    // The mention was already moved through detection and placeholder-posting
    // by Pass A. Feed those events to the machine so it lands in `placeholder_posted`
    // and the agent stage runs from there.
    supervisor.send(rec.mention, {type: 'POST_PLACEHOLDER'})
    supervisor.send(rec.mention, {type: 'PLACEHOLDER_POSTED', placeholderId: rec.placeholderId})
    supervisor.send(rec.mention, {type: 'RUN_AGENT'})

    let replyBody: string | null = null
    try {
      const cb = (actor as any).logic.config.actors as never
      void cb // satisfy noUnusedLocals while keeping types intact
      const ran = await runAgentForActor(rec, opts)
      replyBody = ran.replyBody
      supervisor.send(rec.mention, {type: 'AGENT_DONE', replyBody})
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      supervisor.send(rec.mention, {type: 'AGENT_ERROR', reason})
      audit.trace({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'agent_error',
        data: {commentId: rec.mention.commentId, reason},
      })
      errored++
      continue
    }

    supervisor.send(rec.mention, {type: 'FINALISE'})
    try {
      const r = await cli.runWrite(['comment', 'edit', rec.placeholderId, '--body', replyBody!])
      if (r.exitCode !== 0) {
        throw new Error(`comment edit failed: exit=${r.exitCode} stderr=${r.stderr.slice(0, 200)}`)
      }
      supervisor.send(rec.mention, {type: 'FINALISED'})
      state.finalisePlaceholder(rec.mentionId, rec.placeholderId)
      state.markProcessed(rec.mention, audit.meta.runId, replyBody ? 'replied' : 'error')
      audit.trace({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'reply_finalised',
        data: {
          commentId: rec.mention.commentId,
          placeholderId: rec.placeholderId,
          replyPreview: replyBody!.slice(0, 200),
        },
      })
      finalised++
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      supervisor.send(rec.mention, {type: 'FINALISE_ERROR', reason})
      audit.trace({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'reply_edit_failed',
        data: {commentId: rec.mention.commentId, placeholderId: rec.placeholderId, reason},
      })
      errored++
    }
  }

  supervisor.stopAll()
  return {finalised, errored}
}

async function runAgentForActor(
  rec: PlaceholderRecord,
  opts: RunMachinePassBOptions,
): Promise<{replyBody: string}> {
  const {config, cli, audit, siteAccount, fallbackBody} = opts
  const question = rec.mention.text.replace(/￼/g, ' ').trim()
  const context = await gatherCommentReplyContext({cli, mention: rec.mention, siteAccount, audit})
  if (config.useMastraAgent) {
    const {runMastraReply} = await import('../agent/mastra-agent.js')
    const reply = await runMastraReply({question, context, mention: rec.mention, audit, cli})
    return {replyBody: reply ?? fallbackBody}
  }
  const reply = await draftReply(question, context, audit)
  return {replyBody: reply ?? fallbackBody}
}
