// Run with: node --test .github/scripts/merge-when-green.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const {decide} = require('./merge-when-green.cjs')

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const pr = (over = {}) => ({
  state: 'open',
  draft: false,
  mergeable: true,
  head: {sha: HEAD},
  user: {login: 'author'},
  ...over,
})
const review = (id, login, state, commit = HEAD) => ({id, user: {login}, state, commit_id: commit})
const check = (id, name, conclusion, status = 'completed') => ({id, name, status, conclusion})
const base = (over = {}) => ({
  pr: pr(),
  reviews: [review(1, 'maintainer', 'APPROVED')],
  permissionByLogin: {maintainer: 'admin', outsider: 'read', author: 'triage'},
  checkRuns: [check(1, 'Lint', 'success'), check(2, 'publish', 'skipped')],
  workflowRuns: [],
  ...over,
})

test('merges when a maintainer approved the head and every check passed', () => {
  assert.deepEqual(decide(base()), {ok: true, approvers: ['maintainer']})
})

test('an approval from someone without write access does not count', () => {
  const result = decide(base({reviews: [review(1, 'outsider', 'APPROVED')]}))
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(), /no maintainer has approved/)
})

test('an approval of an older commit does not count', () => {
  const result = decide(base({reviews: [review(1, 'maintainer', 'APPROVED', OLD)]}))
  assert.equal(result.ok, false)
  assert.match(result.reasons.join(), /older commit/)
})

test('a later change request overrides an earlier approval, and a comment does not', () => {
  const blocked = decide(
    base({reviews: [review(1, 'maintainer', 'APPROVED'), review(2, 'maintainer', 'CHANGES_REQUESTED')]}),
  )
  assert.equal(blocked.ok, false)
  const stillApproved = decide(
    base({reviews: [review(1, 'maintainer', 'APPROVED'), review(2, 'maintainer', 'COMMENTED')]}),
  )
  assert.equal(stillApproved.ok, true)
})

test('waits for running checks and refuses failed ones', () => {
  const running = decide(base({checkRuns: [check(1, 'Lint', 'success'), check(2, 'e2e', null, 'in_progress')]}))
  assert.match(running.reasons.join(), /still running: e2e/)
  const failed = decide(base({checkRuns: [check(1, 'Lint', 'success'), check(2, 'e2e', 'failure')]}))
  assert.match(failed.reasons.join(), /failed: e2e/)
})

test('a re-run replaces the failed attempt with the same name', () => {
  assert.equal(decide(base({checkRuns: [check(1, 'e2e', 'failure'), check(2, 'e2e', 'success')]})).ok, true)
})

test('does not merge before any check exists, or while workflows are still starting', () => {
  assert.match(decide(base({checkRuns: []})).reasons.join(), /no check has passed yet/)
  const starting = decide(base({workflowRuns: [{name: 'Test Go', status: 'queued'}]}))
  assert.match(starting.reasons.join(), /workflows still starting: Test Go/)
})

test('drafts, conflicts and closed pull requests never merge', () => {
  assert.equal(decide(base({pr: pr({draft: true})})).ok, false)
  assert.equal(decide(base({pr: pr({mergeable: false})})).ok, false)
  assert.equal(decide(base({pr: pr({mergeable: null})})).ok, false)
  assert.equal(decide(base({pr: pr({state: 'closed'})})).ok, false)
})

test("the author's own approval does not count", () => {
  const result = decide(base({reviews: [review(1, 'author', 'APPROVED')], permissionByLogin: {author: 'admin'}}))
  assert.equal(result.ok, false)
})
