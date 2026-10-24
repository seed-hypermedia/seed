import {setDocumentAppPlatform} from '@shm/shared/document-app'

/** Install same-origin document apps; only the parent fetches authenticated HTML as data. */
export function installWebDocumentApps() {
  setDocumentAppPlatform({
    openExternalUrl(url, newWindow) {
      if (newWindow) {
        const opened = window.open(url, '_blank')
        if (!opened) throw new Error('The browser blocked the new tab. Open the link in this tab instead.')
        opened.opener = null
      } else window.location.assign(url)
    },
    async loadAppHtml({id, cid, version}, signal) {
      const query = new URLSearchParams({id, cid, version})
      const response = await fetch(`/hm/api/app?${query}`, {signal})
      if (!response.ok) throw new Error(`Could not load this app (${response.status}).`)
      return response.text()
    },
  })
}
