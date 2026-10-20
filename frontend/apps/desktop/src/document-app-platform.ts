import {setDocumentAppPlatform} from '@shm/shared/document-app'

/** Document apps on desktop: the main process serves the app folder under its own scheme. */
export function registerDesktopDocumentAppPlatform() {
  setDocumentAppPlatform({resolveAppUrl: (input) => window.documentApps.open(input)})
}
