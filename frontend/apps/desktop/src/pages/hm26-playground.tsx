import {useOpenUrl} from '@/open-url'
import {API_HTTP_URL} from '@shm/shared/constants'
import {useEffect} from 'react'

/** The page the app's own API server serves. It is one origin, so the frame can talk to this window. */
const PLAYGROUND_URL = `${API_HTTP_URL}/hm/playground/`

/**
 * The HM26 playground inside the app window. The page itself lives on the API server, where its
 * world and evaluator are, and loads here in a frame. Links to Hypermedia documents, such as the
 * HM26 schema pages, arrive as messages from the frame and open as app routes.
 */
export default function HM26PlaygroundPage() {
  const openUrl = useOpenUrl()
  useEffect(() => {
    const origin = new URL(PLAYGROUND_URL).origin
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as {type?: unknown; url?: unknown} | null
      if (data?.type === 'hm26-playground-open' && typeof data.url === 'string') openUrl(data.url)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [openUrl])
  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
      <iframe title="HM26 playground" src={PLAYGROUND_URL} className="h-full w-full border-0" />
    </div>
  )
}
