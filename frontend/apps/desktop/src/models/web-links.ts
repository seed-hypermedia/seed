import type {AppQueryClient} from '@/query-client'
import {client} from '@/trpc'
import {useEffect, useRef, useState} from 'react'
import {queryKeys} from './query-keys'

function parseHTML(html: string): Document {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  return doc
}
function extractMetaTagValue(doc: Document, name: string): string | null {
  const metaTag = doc.querySelector(`meta[name="${name}"]`)
  return metaTag ? metaTag.getAttribute('content') : null
}

export type WebLinkMeta = {
  hmId: string | null
  hmUrl: string | null
  hmVersion: string | null
  hmTitle: string | null
  blockRef: string | null
}

export function useWaitForPublication(url: string, secondsUntilTimeout = 120) {
  const [resultMeta, setResultMeta] = useState<null | WebLinkMeta>(null)
  const [timedOut, setTimedOut] = useState(false)
  const isTimedOutRef = useRef(false)
  useEffect(() => {
    isTimedOutRef.current = false
    async function doQuery() {
      if (isTimedOutRef.current) return
      const meta = await fetchWebLinkMeta(url)
      if (meta?.hmId) {
        setResultMeta(meta)
      } else {
        if (isTimedOutRef.current) setTimedOut(true)
        else doQuery()
      }
    }
    doQuery()
    const timeoutId = setTimeout(() => {
      isTimedOutRef.current = true
    }, secondsUntilTimeout * 1000)
    return () => {
      clearTimeout(timeoutId)
    }
  }, [url, secondsUntilTimeout])
  return {resultMeta, timedOut}
}

// export async function fetchWebLinkMeta(
//   url: string,
// ): Promise<WebLinkMeta | null> {
//   if (!url) return null
//   try {
//     if (!url.startsWith('http')) return null
//     const webResponse = await fetch(url, {
//       method: 'GET',
//     })
//     const htmlData = await webResponse.text()
//     const doc = parseHTML(htmlData)
//     const hmId = extractMetaTagValue(doc, 'hypermedia-entity-id')
//     const hmUrl = extractMetaTagValue(doc, 'hypermedia-url')
//     const hmVersion = extractMetaTagValue(doc, 'hypermedia-entity-version')
//     const hmTitle = extractMetaTagValue(doc, 'hypermedia-entity-title')
//     const fragment = parseFragment(url)
//     return {
//       hmUrl,
//       hmId,
//       hmVersion,
//       hmTitle,
//       blockRef: fragment?.blockId || null,
//     }
//   } catch (e) {
//     return null
//   }
// }

export async function fetchWebLinkMeta(
  url: string,
): Promise<Record<string, string>> {
  const queried = await client.web.queryMeta.query(url)
  return queried.meta
}

function queryWebLink(url: string, enabled: boolean) {
  return {
    queryKey: [queryKeys.GET_URL, url],
    enabled,
    queryFn: async () => {
      const meta = await fetchWebLinkMeta(url)
      return meta
    },
  }
}

export function loadWebLinkMeta(appClient: AppQueryClient, url: string) {
  return appClient.client.fetchQuery(queryWebLink(url, true))
}
