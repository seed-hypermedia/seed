import {setDocumentPagePlatform} from '@shm/shared/document-page'

/** Install same-origin document pages; only the parent fetches authenticated HTML as data. */
export function installWebDocumentPages() {
  setDocumentPagePlatform({
    openExternalUrl(url, newWindow) {
      if (newWindow) {
        const opened = window.open(url, '_blank')
        if (!opened) throw new Error('The browser blocked the new tab. Open the link in this tab instead.')
        opened.opener = null
      } else window.location.assign(url)
    },
    async loadPageHtml({id, cid, version}, signal) {
      const query = new URLSearchParams({id, cid, version})
      const response = await fetch(`/hm/api/page?${query}`, {signal})
      if (!response.ok) throw new Error(`Could not load this page (${response.status}).`)
      return response.text()
    },
  })
}
