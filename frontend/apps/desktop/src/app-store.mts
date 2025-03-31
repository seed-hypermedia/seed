import Store from 'electron-store'
import {userDataPath} from './app-paths'

// Define the store interface with the methods we need

interface CustomStore extends Store<Record<string, any>> {
  get: (key: string) => any
  set: (key: string, value: any) => void
  delete: (key: string) => void
}

export const appStore = new Store<Record<string, any>>({
  name: 'AppStore',
  cwd: userDataPath,
}) as unknown as CustomStore

export const commentDraftStore = new Store<Record<string, any>>({
  name: 'CommentDraft.2',
  cwd: userDataPath,
}) as unknown as CustomStore

export const secureStore = new Store<Record<string, any>>({
  name: 'SecureStore',
  cwd: userDataPath,
}) as unknown as CustomStore
