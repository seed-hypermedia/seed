import {APIRouter} from '@shm/shared/api'
import {grpcClient} from './grpc-client'

export async function desktopRequest<K extends keyof typeof APIRouter>(
  key: K,
  input: Parameters<(typeof APIRouter)[K]['getData']>[1],
): Promise<Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>> {
  const apiDefinition = APIRouter[key]

  // NOTE: Type assertion required due to TypeScript limitation
  // When indexing APIRouter[key] with a generic K, TypeScript treats the result
  // as a union of all possible implementations, even though K is constrained.
  // The types are guaranteed correct at the call site through the function signature.
  const result = await apiDefinition.getData(grpcClient, input as never)
  return result as Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>
}
