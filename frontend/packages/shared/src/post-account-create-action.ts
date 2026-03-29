import {invalidateQueries} from './models/query-client'
import {queryKeys} from './models/query-keys'
import {defaultJoinedSiteUid, publishDefaultJoinedSite} from './publish-default-joined-site'

type PostAccountCreateActionInput = Parameters<typeof publishDefaultJoinedSite>[0]
type PostAccountCreateActionClient = Parameters<typeof publishDefaultJoinedSite>[1]
export {defaultJoinedSiteUid} from './publish-default-joined-site'

/**
 * Runs client-side follow-up work after a brand new account has been created.
 *
 * The publish step lives in `publish-default-joined-site.ts` so Vault can reuse
 * it without importing query/cache infrastructure into its browser bundle. This
 * wrapper is intentionally web-facing: it layers React Query invalidation on top
 * of the pure publish helper for callers that already depend on shared query
 * state.
 */
export async function postAccountCreateAction(
  input: PostAccountCreateActionInput,
  client: PostAccountCreateActionClient,
): Promise<void> {
  const didPublish = await publishDefaultJoinedSite(input, client)

  if (!didPublish) {
    return
  }

  // Web callers keep the previous behavior and refresh contact queries after
  // the background publish step. The pure helper intentionally does not know
  // about query state so it can stay safe for non-web consumers like Vault.
  invalidateQueries([queryKeys.CONTACTS_ACCOUNT, input.accountUid])
  invalidateQueries([queryKeys.CONTACTS_SUBJECT, defaultJoinedSiteUid])
}
