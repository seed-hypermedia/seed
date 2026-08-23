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
}

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
