import {extractIpfsUrlCid, unpackHmId} from '@shm/shared'
import {useCallback} from 'react'
import {useNavigate} from 'react-router-dom'
import {exploreHref} from './exploreHref'

/**
 * Navigation callback for the JSON DataViewer. Values rendered there are raw
 * hypermedia strings (`hm://…`, `ipfs://…`), not Explore route paths — handing
 * them straight to react-router's `navigate` treats them as *relative* paths and
 * appends them to the current URL (e.g. `…/:comments/hm:/…`). This converts them
 * to the corresponding Explore route first; anything else is passed through.
 */
export function useHmNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (url: string) => {
      if (typeof url === 'string') {
        const cid = extractIpfsUrlCid(url)
        if (cid) {
          navigate(`/ipfs/${cid}`)
          return
        }
        if (url.startsWith('hm://')) {
          const id = unpackHmId(url)
          if (id) {
            navigate(exploreHref(id))
            return
          }
        }
      }
      navigate(url)
    },
    [navigate],
  )
}
