export type RootStackParamList = {
  ServerSelect: undefined
  Home: {
    serverUrl: string
  }
  MnemonicInput: undefined
  Account: {
    mnemonic: string
  }
}

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
