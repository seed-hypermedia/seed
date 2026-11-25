import Store from 'electron-store'
import {userDataPath} from './app-paths'

/** Stores desktop application preferences. */
export const appStore = new Store<Record<string, any>>({
  name: 'AppStore',
  cwd: userDataPath,
})

/** Stores legacy comment drafts for migration. */
export const commentDraftStore = new Store<Record<string, any>>({
  name: 'CommentDraft.2',
  cwd: userDataPath,
})

/** Stores desktop security settings. */
export const secureStore = new Store<Record<string, any>>({
  name: 'SecureStore',
  cwd: userDataPath,
})
