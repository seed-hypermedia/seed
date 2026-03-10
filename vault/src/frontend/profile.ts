export interface AccountProfileSummary {
  name?: string
  avatar?: string
  description?: string
}

export const PROFILE_FALLBACK_LABEL = 'Account'
export type ProfileLoadState = 'not_found' | 'unavailable'

export function getProfileDisplayName(
  profile?: Pick<AccountProfileSummary, 'name'>,
  profileLoadState?: ProfileLoadState,
) {
  if (profile?.name) return profile.name
  if (profileLoadState === 'not_found') return 'Profile not found'
  if (profileLoadState === 'unavailable') return 'Profile unavailable'
  return PROFILE_FALLBACK_LABEL
}
