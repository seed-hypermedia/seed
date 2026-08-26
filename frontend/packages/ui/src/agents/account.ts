import {getAgentsPlatform} from './platform'

/**
 * UID of the account that signs agent actions for the current user.
 *
 * On desktop this is the selected account (the daemon can sign for it); on web it is the local
 * device key, which is the account from the agent server's perspective.
 */
export function useSelectedAccountId(): string | null | undefined {
  return getAgentsPlatform().useAccountUid()
}
