/**
 * The account that signs agent actions on this device.
 *
 * A thin re-export of the shared `useSelectedAccountId`, which reads through the platform seam to
 * mobile's vault adapter. Screens import this rather than reaching into the vault directly, so the
 * agents UI and the shared models can never disagree about who is acting — the agent server scopes
 * every agent, session and provider by signing account.
 *
 * `undefined` means the vault is still opening; `null` means there is no identity yet.
 */

export {useSelectedAccountId as useAgentsAccount} from '@shm/ui/agents/account'
