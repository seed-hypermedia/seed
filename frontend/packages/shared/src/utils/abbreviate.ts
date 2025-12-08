export function abbreviateCid(cid?: string) {
  if (!cid) return ''
  if (cid === null) return '(empty)'
  // a cid is a long string, we want to shorten to 12345...12345
  return `${cid.slice(0, 8)}...${cid.slice(-8)}`
}

export function abbreviateUid(uid?: string | null) {
  if (!uid) return ''
  // take the last 8 characters because the uid starts with similar chars
  return uid.slice(-8)
}
