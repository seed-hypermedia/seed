// Merge-when-green: the decision and the orchestration behind
// .github/workflows/merge-when-green.yml. Runs from the default branch only and never
// checks out or executes pull-request code.

const LABEL = 'merge-when-green'
const COMMAND = '/merge-when-green'
const CANCEL_COMMAND = '/merge-cancel'
const WRITE_ROLES = new Set(['admin', 'maintain', 'write'])
const PASSING = new Set(['success', 'skipped', 'neutral'])

/**
 * Decides whether a queued pull request may merge now. Pure: every input is passed in.
 * Returns `{ok: true, approvers}` or `{ok: false, reasons}`.
 */
function decide({pr, reviews, permissionByLogin, checkRuns, workflowRuns}) {
  const reasons = []
  const head = pr.head.sha
  if (pr.state !== 'open') reasons.push('the pull request is not open')
  if (pr.draft) reasons.push('the pull request is a draft')
  if (pr.mergeable === false) reasons.push('the pull request has merge conflicts')
  if (pr.mergeable == null) reasons.push('GitHub has not finished computing mergeability')

  // The latest decisive review per person; plain comments do not change a decision.
  const latest = new Map()
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!review.user || review.state === 'COMMENTED' || review.state === 'PENDING') continue
    latest.set(review.user.login, review)
  }
  const approvers = []
  for (const [login, review] of latest) {
    if (!WRITE_ROLES.has(permissionByLogin[login])) continue
    if (login === pr.user.login) continue
    if (review.state === 'CHANGES_REQUESTED') reasons.push(`@${login} requested changes`)
    if (review.state === 'APPROVED') {
      if (review.commit_id === head) approvers.push(login)
      else
        reasons.push(
          `@${login} approved an older commit (${String(review.commit_id).slice(0, 7)}), not the current head`,
        )
    }
  }
  if (approvers.length === 0 && !reasons.some((reason) => reason.includes('approved an older commit'))) {
    reasons.push('no maintainer has approved the current head commit')
  }

  // The newest check run per name, so a re-run replaces the attempt it retried.
  const newest = new Map()
  for (const run of [...checkRuns].sort((a, b) => a.id - b.id)) newest.set(run.name, run)
  const runs = [...newest.values()]
  const pending = runs.filter((run) => run.status !== 'completed')
  const failed = runs.filter((run) => run.status === 'completed' && !PASSING.has(run.conclusion))
  if (!runs.some((run) => run.conclusion === 'success')) reasons.push('no check has passed yet')
  if (pending.length) reasons.push(`still running: ${pending.map((run) => run.name).join(', ')}`)
  if (failed.length) reasons.push(`failed: ${failed.map((run) => `${run.name} (${run.conclusion})`).join(', ')}`)
  const unfinishedWorkflows = workflowRuns.filter((run) => run.status !== 'completed')
  if (unfinishedWorkflows.length && !pending.length) {
    reasons.push(`workflows still starting: ${unfinishedWorkflows.map((run) => run.name).join(', ')}`)
  }

  return reasons.length ? {ok: false, reasons} : {ok: true, approvers}
}

/** Entry point called by actions/github-script. */
async function run({github, context, core, mergeToken}) {
  const {owner, repo} = context.repo
  const usingFallbackToken = !mergeToken
  /** Merges with the dedicated token when there is one, so push workflows on main still start. */
  async function merge(params) {
    if (!mergeToken) return github.rest.pulls.merge({owner, repo, ...params})
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${params.pull_number}/merge`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${mergeToken}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({merge_method: params.merge_method, sha: params.sha, commit_title: params.commit_title}),
    })
    if (!response.ok) throw new Error(`merge failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
  }
  const permissionCache = {}
  async function permissionOf(login) {
    if (!(login in permissionCache)) {
      try {
        const {data} = await github.rest.repos.getCollaboratorPermissionLevel({owner, repo, username: login})
        permissionCache[login] = data.role_name || data.permission
      } catch {
        permissionCache[login] = 'none'
      }
    }
    return permissionCache[login]
  }
  async function comment(number, body) {
    await github.rest.issues.createComment({owner, repo, issue_number: number, body})
  }
  async function unqueue(number) {
    try {
      await github.rest.issues.removeLabel({owner, repo, issue_number: number, name: LABEL})
    } catch {
      // Already removed.
    }
  }

  async function evaluate(number, {announce}) {
    const {data: pr} = await github.rest.pulls.get({owner, repo, pull_number: number})
    if (pr.state !== 'open') {
      await unqueue(number)
      return
    }
    const reviews = await github.paginate(github.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    })
    const permissionByLogin = {}
    for (const review of reviews) {
      if (review.user) permissionByLogin[review.user.login] = await permissionOf(review.user.login)
    }
    const checkRuns = await github.paginate(github.rest.checks.listForRef, {
      owner,
      repo,
      ref: pr.head.sha,
      per_page: 100,
    })
    const workflowRuns = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      owner,
      repo,
      head_sha: pr.head.sha,
      per_page: 100,
    })
    const decision = decide({pr, reviews, permissionByLogin, checkRuns, workflowRuns})
    if (!decision.ok) {
      core.info(`#${number} is not ready: ${decision.reasons.join('; ')}`)
      if (announce) {
        await comment(
          number,
          `Queued to merge when green. Waiting on:\n${decision.reasons
            .map((reason) => `- ${reason}`)
            .join('\n')}\n\nComment \`${CANCEL_COMMAND}\` to leave the queue.`,
        )
      }
      return
    }
    // `sha` makes GitHub refuse the merge if the head moved after this evaluation.
    await merge({
      pull_number: number,
      merge_method: 'squash',
      sha: pr.head.sha,
      commit_title: `${pr.title} (#${number})`,
    })
    await unqueue(number)
    const note = usingFallbackToken
      ? '\n\nMerged with the workflow token, so workflows that run on pushes to main did not start for this commit. Add a `MERGE_QUEUE_TOKEN` secret to fix that.'
      : ''
    await comment(
      number,
      `Merged by merge-when-green at ${pr.head.sha.slice(0, 7)}: approved by ${decision.approvers
        .map((login) => `@${login}`)
        .join(', ')}, all checks passed.${note}`,
    )
    core.notice(`Merged #${number}`)
  }

  if (context.eventName === 'issue_comment') {
    const issue = context.payload.issue
    if (!issue.pull_request) return
    const body = (context.payload.comment.body || '').trim()
    const command = body.split(/\s+/)[0]
    if (command !== COMMAND && command !== CANCEL_COMMAND) return
    const actor = context.payload.comment.user.login
    const allowed = actor === issue.user.login || WRITE_ROLES.has(await permissionOf(actor))
    if (!allowed) {
      await comment(issue.number, `@${actor}, only the pull request's author or a maintainer can use \`${command}\`.`)
      return
    }
    if (command === CANCEL_COMMAND) {
      await unqueue(issue.number)
      await comment(issue.number, 'Removed from the merge-when-green queue.')
      return
    }
    try {
      await github.rest.issues.getLabel({owner, repo, name: LABEL})
    } catch {
      await github.rest.issues.createLabel({
        owner,
        repo,
        name: LABEL,
        color: '0e8a16',
        description: 'Merge automatically once approved at the current head and all checks pass',
      })
    }
    await github.rest.issues.addLabels({owner, repo, issue_number: issue.number, labels: [LABEL]})
    await evaluate(issue.number, {announce: true})
    return
  }

  // Scheduled sweeps and finished CI runs: look at everything in the queue.
  const queued = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    labels: LABEL,
    per_page: 100,
  })
  for (const issue of queued) {
    if (!issue.pull_request) continue
    try {
      await evaluate(issue.number, {announce: false})
    } catch (error) {
      core.warning(`#${issue.number}: ${error.message}`)
    }
  }
}

module.exports = {run, decide, LABEL, COMMAND, CANCEL_COMMAND}
