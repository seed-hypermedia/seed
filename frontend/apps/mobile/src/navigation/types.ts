export type RootStackParamList = {
  ServerSelect: undefined
  Home: {
    serverUrl: string
  }
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
  /** Any hypermedia document page (home docs included). */
  Document: {
    uid: string
    path: string[]
    /** Optional title for the header while the document loads. */
    title?: string
  }
}

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
