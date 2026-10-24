import {setDocumentAppPlatform} from '@shm/shared/document-app'

/** Install same-origin document apps; only the parent fetches authenticated HTML as data. */
export function installWebDocumentApps() {
  setDocumentAppPlatform({
    async loadAppHtml({id, cid, version}, signal) {
      const query = new URLSearchParams({id, cid, version})
      const response = await fetch(`/hm/api/app?${query}`, {signal})
      if (!response.ok) throw new Error(`Could not load this app (${response.status}).`)
      return response.text()
    },
  })
}
