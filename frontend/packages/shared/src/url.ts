import {UnpackedHypermediaId} from './hm-types'
import {useUniversalAppContext} from './routing'

export function useResourceUrl() {
  const {origin} = useUniversalAppContext()
  return (id: UnpackedHypermediaId) => {
    console.log('~origin', origin)
    console.log('~id', id)
    return '#lolfix'
  }
}
