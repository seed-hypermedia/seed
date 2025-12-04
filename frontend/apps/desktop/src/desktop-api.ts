import {APIRouter} from '@shm/shared/api'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {grpcClient} from './grpc-client'

// queryDaemon for handlers that need direct HTTP access (e.g., GetCID)
async function queryDaemon<T>(pathAndQuery: string): Promise<T> {
  const daemonHost = DAEMON_HTTP_URL
  const response = await fetch(`${daemonHost}${pathAndQuery}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

export async function desktopRequest<K extends keyof typeof APIRouter>(
  key: K,
  input: Parameters<(typeof APIRouter)[K]['getData']>[1],
): Promise<Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>> {
  const apiDefinition = APIRouter[key]

  // NOTE: Type assertion required due to TypeScript limitation
  // When indexing APIRouter[key] with a generic K, TypeScript treats the result
  // as a union of all possible implementations, even though K is constrained.
  // The types are guaranteed correct at the call site through the function signature.
  const result = await apiDefinition.getData(
    grpcClient,
    input as never,
    queryDaemon,
  )
  return result as Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>
}
