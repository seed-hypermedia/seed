import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import type {RecentsResult} from './recents'

const DAY = 86_400_000
const VISIT_HALF_LIFE = 7 * DAY
const ACTIVITY_HALF_LIFE = 14 * DAY

const accountRoleLabels = {
  'site-owner': 'Site owner',
  'site-editor': 'Site editor',
  'document-editor': 'Document editor',
  'site-follower': 'Site follower',
}

/** Loaded conversation participants used only for account mention relevance. */
export type MentionThreadContext = {
  participants?: {uid: string; latestCommentTime?: number; isThreadAuthor?: boolean}[]
  replyAuthorUid?: string
  /** The acting account is omitted from reply suggestions, including known aliases. */
  selectedAccountUid?: string
}

function timeAgo(time: number, now: number) {
  const elapsed = Math.max(0, now - time)
  if (elapsed < 60_000) return 'just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / 3_600_000)}h ago`
  if (elapsed < 365 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
  return `${Math.floor(elapsed / (365 * DAY))}y ago`
}

/** Shared desktop/mobile subtitle, keeping account IDs only as a last-resort hint. */
export function mentionCandidateSubtitle(candidate: HMMentionCandidate) {
  const publicName = candidate.petname && candidate.publicName !== candidate.petname ? candidate.publicName : undefined
  const hint = [candidate.hint, publicName].filter(Boolean).join(' · ')
  if (hint) return hint
  if (candidate.type === 'document') return candidate.parentNames.join(' / ')
  const uid = candidate.id.uid
  return uid.length > 16 ? `${uid.slice(0, 8)}…${uid.slice(-6)}` : uid
}

/** Canonical key distinguishing account profiles from home documents and ignoring versions. */
export function mentionCandidateKey(id: HMMentionCandidate['id'], mode: HMMentionCandidate['type']) {
  return `${mode}:${id.uid}:${mode === 'document' ? JSON.stringify(id.path || []) : ''}`
}

/** Deterministic text-first ranking with blended local and public relevance signals. */
export function rankMentionCandidates(
  candidates: HMMentionCandidate[],
  query: string,
  recents: RecentsResult[],
  now = Date.now(),
  thread: MentionThreadContext = {},
): HMMentionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase()
  const visits = new Map(
    recents.map((r) => [mentionCandidateKey(r.id, r.id.path?.[0] === ':profile' ? 'account' : 'document'), r.time]),
  )
  const participants = new Map(thread.participants?.map((participant) => [participant.uid, participant]))
  // Alias and canonical search hits can arrive in either order. Collect identities
  // before deduplicating so the winning row keeps the thread's original author ID.
  const accountIdentities = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    if (candidate.type !== 'account') continue
    const identities = accountIdentities.get(candidate.id.uid) || new Set([candidate.id.uid])
    if (candidate.sourceAccountUid) identities.add(candidate.sourceAccountUid)
    accountIdentities.set(candidate.id.uid, identities)
  }
  const seen = new Set<string>()
  return candidates
    .flatMap((candidate) => {
      if (
        candidate.type === 'account' &&
        thread.selectedAccountUid &&
        accountIdentities.get(candidate.id.uid)?.has(thread.selectedAccountUid)
      )
        return []
      const key = mentionCandidateKey(candidate.id, candidate.type)
      if (seen.has(key)) return []
      seen.add(key)
      const labels = [
        candidate.title,
        candidate.publicName,
        candidate.petname,
        candidate.id.uid,
        candidate.id.path?.join('/'),
      ]
        .filter((v): v is string => !!v)
        .map((v) => v.toLocaleLowerCase())
      let tier = normalized ? 4 : 0
      for (const label of labels) {
        if (label === normalized) tier = Math.min(tier, 0)
        else if (label.startsWith(normalized)) tier = Math.min(tier, 1)
        else if (normalized.split(/\s+/).every((token) => label.includes(token))) tier = Math.min(tier, 2)
        else {
          let at = 0
          for (const char of label) if (char === normalized[at]) at++
          if (at === normalized.length) tier = Math.min(tier, 3)
        }
      }
      if (tier === 4) return []
      const visit = visits.get(key)
      const visitScore = visit === undefined ? 0 : Math.pow(0.5, Math.max(0, now - visit) / VISIT_HALF_LIFE)
      const activityScore =
        candidate.activityTime === undefined
          ? 0
          : Math.pow(0.5, Math.max(0, now - candidate.activityTime) / ACTIVITY_HALF_LIFE)
      const identities = candidate.type === 'account' ? accountIdentities.get(candidate.id.uid) : undefined
      const matchingParticipants = Array.from(identities || []).flatMap((uid) => participants.get(uid) || [])
      const participant = matchingParticipants.length
        ? {
            isThreadAuthor: matchingParticipants.some((p) => p.isThreadAuthor),
            latestCommentTime: matchingParticipants.reduce<number | undefined>(
              (latest, p) =>
                p.latestCommentTime === undefined
                  ? latest
                  : Math.max(latest ?? p.latestCommentTime, p.latestCommentTime),
              undefined,
            ),
          }
        : undefined
      const directReply = !!thread.replyAuthorUid && !!identities?.has(thread.replyAuthorUid)
      const score =
        2 * visitScore +
        1.5 * activityScore +
        Number(candidate.sameSite) +
        Number(candidate.type === 'account' && candidate.issuedContact) +
        (directReply ? 5 : participant ? 3 : 0)
      const activityHint =
        candidate.activityTime === undefined
          ? undefined
          : `${candidate.activityType === 'comment' ? 'Commented' : 'Published'} ${timeAgo(
              candidate.activityTime,
              now,
            )}`
      const visitHint = visit === undefined ? undefined : `Visited ${timeAgo(visit, now)}`
      let hint: string | undefined
      if (candidate.type === 'account') {
        const relationship = directReply
          ? 'Replying to'
          : participant?.isThreadAuthor
            ? 'Thread author'
            : participant
              ? 'In this thread'
              : candidate.accountRole
                ? accountRoleLabels[candidate.accountRole]
                : candidate.issuedContact
                  ? 'Contact'
                  : undefined
        const activity =
          participant?.latestCommentTime === undefined
            ? activityHint
            : `${participant.isThreadAuthor ? 'Commented' : 'Replied'} ${timeAgo(participant.latestCommentTime, now)}`
        hint =
          [activity || (!relationship ? visitHint : undefined), relationship].filter(Boolean).join(' · ') || undefined
      } else {
        hint = activityHint || visitHint || (candidate.sameSite ? 'In this space' : undefined)
        if (!candidate.id.path?.length) hint = ['Home document', hint].filter(Boolean).join(' · ')
      }
      return [{candidate: {...candidate, hint}, tier, score, key}]
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.score - a.score ||
        a.candidate.title.localeCompare(b.candidate.title) ||
        a.key.localeCompare(b.key),
    )
    .map((v) => v.candidate)
}
