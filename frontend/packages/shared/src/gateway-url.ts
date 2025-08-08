import {DEFAULT_GATEWAY_URL} from './constants'
import {writeableStateStream} from './utils'

const [_, gatewayUrl] = writeableStateStream(DEFAULT_GATEWAY_URL)

export function useGatewayUrlStream() {
  return gatewayUrl
}
