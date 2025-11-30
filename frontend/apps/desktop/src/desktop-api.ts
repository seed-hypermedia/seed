import {HMRequest} from '@shm/shared'
import {APIRouter} from '@shm/shared/api'
import {grpcClient} from './grpc-client'

export async function desktopRequest<Req extends HMRequest>(
  key: Req['key'],
  input: Req['input'],
): Promise<Req['output']> {
  const apiDefinition = APIRouter[key]
  const result = await apiDefinition.getData(grpcClient, input)
  return result
}
