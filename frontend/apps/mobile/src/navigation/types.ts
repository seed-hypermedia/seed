export type RootStackParamList = {
  ServerSelect: undefined
  MnemonicInput: undefined
  Account: {
    mnemonic: string
  }
  Vault: undefined
  VaultConnect: undefined
  CreateIdentity: undefined
  Identity: {
    accountId: string
  }
  Notifications: undefined
  /** The agents index: the configured agent server and its agents. */
  Agents: undefined
  /** One agent: its configuration and its conversations. */
  Agent: {
    agentId: string
    serverUrl: string
    /** Optional agent name for the header while the detail loads. */
    title?: string
  }
  /** One agent conversation (the shared log). */
  AgentSession: {
    sessionId: string
    serverUrl: string
    agentId?: string
    /** Optional agent name for the header while the session loads. */
    title?: string
  }
  /**
   * Any hypermedia document page. This is the app's only content screen — the
   * server's own site home is just this route with the site's uid and an empty
   * path, so it gets the same tabs, sidebar and rendering as every other page.
   */
  Document: {
    uid: string
    path: string[]
    /** Optional title for the header while the document loads. */
    title?: string
    /** True for the server's site home, which is the root of the stack. */
    isSiteHome?: boolean
  }
  /** One comment thread on a document, with a reply box. */
  Comment: {
    uid: string
    path: string[]
    commentId: string
    /** Version of the document the thread hangs off, for signing replies. */
    docVersion: string
  }
}

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
