export interface AccountProfileSummary {
  name?: string
  avatar?: string
  description?: string
}

export type ProfileLoadState = 'not_found' | 'unavailable'

export function getProfileDisplayName(profile?: AccountProfileSummary, profileLoadState?: ProfileLoadState) {
  if (profile?.name) return profile.name
  if (profileLoadState === 'not_found') return 'Profile not found'
  if (profileLoadState === 'unavailable') return 'Profile unavailable'
  return 'Account'
}

export function getProfileAvatarImageSrc(backendHttpBaseUrl: string, avatar?: string) {
  const prefix = 'ipfs://'
  if (!avatar) return ''
  if (!avatar.startsWith(prefix)) return avatar

  const cid = avatar.slice(prefix.length)
  if (!cid) return ''
  if (!backendHttpBaseUrl) return `/ipfs/${cid}`

  return `${backendHttpBaseUrl.replace(/\/$/, '')}/ipfs/${cid}`
}
