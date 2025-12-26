export type RootStackParamList = {
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
