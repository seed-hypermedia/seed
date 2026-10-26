/**
 * A person who accepts an invitation should be a member of the site the
 * moment they arrive, without pressing Join. The sign-in page leaves this
 * marker before it hands off to the vault; the site header consumes it once
 * the delegation is back and the contact list has loaded, and joins the site
 * (the same site subscription the Join button creates).
 */
export const INVITE_JOIN_KEY = 'hm.invite-join'

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): MarkerStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function markInviteJoin(store: MarkerStorage | null = storage()): void {
  try {
    store?.setItem(INVITE_JOIN_KEY, String(Date.now()))
  } catch {
    // Without storage the person simply gets the Join button.
  }
}

export function hasInviteJoin(store: MarkerStorage | null = storage()): boolean {
  try {
    return !!store?.getItem(INVITE_JOIN_KEY)
  } catch {
    return false
  }
}

export function clearInviteJoin(store: MarkerStorage | null = storage()): void {
  try {
    store?.removeItem(INVITE_JOIN_KEY)
  } catch {
    // nothing to clear
  }
}

/**
 * Whether the header should join the site on the person's behalf now: an
 * invitation sign-in is pending, the person is signed in, the contact list
 * is known and does not yet hold the site.
 */
export function shouldAutoJoin(opts: {
  pending: boolean
  signedIn: boolean
  contactsLoaded: boolean
  isJoined: boolean
  isPendingSpace: boolean
}): boolean {
  return opts.pending && opts.signedIn && opts.contactsLoaded && !opts.isJoined && !opts.isPendingSpace
}
