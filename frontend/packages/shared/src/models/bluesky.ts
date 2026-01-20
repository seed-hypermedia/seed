/**
 * Bluesky/AT Protocol React Query hooks and mutations.
 *
 * This module provides React Query integration for Bluesky operations.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query'
import {queryKeys} from './query-keys'
import {GRPCClient} from '../grpc-client'
import {
  BlueskyConnection,
  BlueskyFeedItem,
  BlueskyNotification,
  BlueskyProfile,
  connectBluesky,
  disconnectBluesky,
  getBlueskyConnectionStatus,
  getBlueskyNotifications,
  getBlueskyProfile,
  getBlueskyTimeline,
  listBlueskyConnections,
  searchBlueskyActors,
  createBlueskyPost,
  deleteBlueskyPost,
  followBlueskyAccount,
  unfollowBlueskyAccount,
  likeBlueskyPost,
  unlikeBlueskyPost,
  repostBlueskyPost,
  unrepostBlueskyPost,
} from '../api-bluesky'

// Query hooks

/**
 * Hook to list all Bluesky connections.
 */
export function useBlueskyConnections(
  client: GRPCClient | undefined,
  options?: Omit<
    UseQueryOptions<BlueskyConnection[], Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    queryKey: [queryKeys.BLUESKY_CONNECTIONS],
    queryFn: () => {
      if (!client) throw new Error('No client')
      return listBlueskyConnections(client)
    },
    enabled: !!client,
    ...options,
  })
}

/**
 * Hook to get connection status for a Seed account.
 */
export function useBlueskyConnectionStatus(
  client: GRPCClient | undefined,
  seedAccount: string | undefined,
  options?: Omit<
    UseQueryOptions<BlueskyConnection | null, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    queryKey: [queryKeys.BLUESKY_CONNECTION_STATUS, seedAccount],
    queryFn: () => {
      if (!client) throw new Error('No client')
      if (!seedAccount) throw new Error('No seed account')
      return getBlueskyConnectionStatus(client, seedAccount)
    },
    enabled: !!client && !!seedAccount,
    ...options,
  })
}

/**
 * Hook to get a Bluesky profile.
 */
export function useBlueskyProfile(
  client: GRPCClient | undefined,
  seedAccount: string | undefined,
  actor: string | undefined,
  options?: Omit<UseQueryOptions<BlueskyProfile, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: [queryKeys.BLUESKY_PROFILE, seedAccount, actor],
    queryFn: () => {
      if (!client) throw new Error('No client')
      if (!seedAccount) throw new Error('No seed account')
      if (!actor) throw new Error('No actor')
      return getBlueskyProfile(client, seedAccount, actor)
    },
    enabled: !!client && !!seedAccount && !!actor,
    ...options,
  })
}

/**
 * Hook to get the Bluesky timeline.
 */
export function useBlueskyTimeline(
  client: GRPCClient | undefined,
  seedAccount: string | undefined,
  options?: {
    limit?: number
    cursor?: string
    algorithm?: string
  } & Omit<
    UseQueryOptions<{feed: BlueskyFeedItem[]; cursor?: string}, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  const {limit, cursor, algorithm, ...queryOptions} = options || {}
  return useQuery({
    queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount, limit, cursor, algorithm],
    queryFn: () => {
      if (!client) throw new Error('No client')
      if (!seedAccount) throw new Error('No seed account')
      return getBlueskyTimeline(client, seedAccount, {limit, cursor, algorithm})
    },
    enabled: !!client && !!seedAccount,
    ...queryOptions,
  })
}

/**
 * Hook to get Bluesky notifications.
 */
export function useBlueskyNotifications(
  client: GRPCClient | undefined,
  seedAccount: string | undefined,
  options?: {
    limit?: number
    cursor?: string
  } & Omit<
    UseQueryOptions<{notifications: BlueskyNotification[]; cursor?: string}, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  const {limit, cursor, ...queryOptions} = options || {}
  return useQuery({
    queryKey: [queryKeys.BLUESKY_NOTIFICATIONS, seedAccount, limit, cursor],
    queryFn: () => {
      if (!client) throw new Error('No client')
      if (!seedAccount) throw new Error('No seed account')
      return getBlueskyNotifications(client, seedAccount, {limit, cursor})
    },
    enabled: !!client && !!seedAccount,
    ...queryOptions,
  })
}

/**
 * Hook to search Bluesky actors.
 */
export function useBlueskySearchActors(
  client: GRPCClient | undefined,
  seedAccount: string | undefined,
  query: string,
  options?: {
    limit?: number
    cursor?: string
  } & Omit<
    UseQueryOptions<{actors: BlueskyProfile[]; cursor?: string}, Error>,
    'queryKey' | 'queryFn'
  >,
) {
  const {limit, cursor, ...queryOptions} = options || {}
  return useQuery({
    queryKey: [queryKeys.BLUESKY_SEARCH_ACTORS, seedAccount, query, limit, cursor],
    queryFn: () => {
      if (!client) throw new Error('No client')
      if (!seedAccount) throw new Error('No seed account')
      return searchBlueskyActors(client, seedAccount, query, {limit, cursor})
    },
    enabled: !!client && !!seedAccount && query.length >= 2,
    ...queryOptions,
  })
}

// Mutation hooks

/**
 * Hook to connect a Bluesky account.
 */
export function useConnectBluesky(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<
    {connection: BlueskyConnection; profile: BlueskyProfile},
    Error,
    {
      seedAccount: string
      identifier: string
      appPassword: string
      pdsUrl?: string
    }
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, identifier, appPassword, pdsUrl}) => {
      if (!client) throw new Error('No client')
      return connectBluesky(client, seedAccount, identifier, appPassword, pdsUrl)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: [queryKeys.BLUESKY_CONNECTIONS]})
    },
    ...options,
  })
}

/**
 * Hook to disconnect a Bluesky account.
 */
export function useDisconnectBluesky(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<void, Error, {seedAccount: string}>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount}) => {
      if (!client) throw new Error('No client')
      return disconnectBluesky(client, seedAccount)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({queryKey: [queryKeys.BLUESKY_CONNECTIONS]})
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_CONNECTION_STATUS, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to create a Bluesky post.
 */
export function useCreateBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<
    {uri: string; cid: string},
    Error,
    {
      seedAccount: string
      text: string
      replyTo?: {
        rootUri: string
        rootCid: string
        parentUri: string
        parentCid: string
      }
      langs?: string[]
    }
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, text, replyTo, langs}) => {
      if (!client) throw new Error('No client')
      return createBlueskyPost(client, seedAccount, text, {replyTo, langs})
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to delete a Bluesky post.
 */
export function useDeleteBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<void, Error, {seedAccount: string; uri: string}>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, uri}) => {
      if (!client) throw new Error('No client')
      return deleteBlueskyPost(client, seedAccount, uri)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to follow a Bluesky account.
 */
export function useFollowBluesky(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<
    {uri: string; cid: string},
    Error,
    {seedAccount: string; subject: string}
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, subject}) => {
      if (!client) throw new Error('No client')
      return followBlueskyAccount(client, seedAccount, subject)
    },
    onSuccess: (_, {seedAccount, subject}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_PROFILE, seedAccount, subject],
      })
    },
    ...options,
  })
}

/**
 * Hook to unfollow a Bluesky account.
 */
export function useUnfollowBluesky(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<void, Error, {seedAccount: string; subject: string}>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, subject}) => {
      if (!client) throw new Error('No client')
      return unfollowBlueskyAccount(client, seedAccount, subject)
    },
    onSuccess: (_, {seedAccount, subject}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_PROFILE, seedAccount, subject],
      })
    },
    ...options,
  })
}

/**
 * Hook to like a Bluesky post.
 */
export function useLikeBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<
    {uri: string; cid: string},
    Error,
    {seedAccount: string; subjectUri: string; subjectCid: string}
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, subjectUri, subjectCid}) => {
      if (!client) throw new Error('No client')
      return likeBlueskyPost(client, seedAccount, subjectUri, subjectCid)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to unlike a Bluesky post.
 */
export function useUnlikeBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<void, Error, {seedAccount: string; uri: string}>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, uri}) => {
      if (!client) throw new Error('No client')
      return unlikeBlueskyPost(client, seedAccount, uri)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to repost a Bluesky post.
 */
export function useRepostBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<
    {uri: string; cid: string},
    Error,
    {seedAccount: string; subjectUri: string; subjectCid: string}
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, subjectUri, subjectCid}) => {
      if (!client) throw new Error('No client')
      return repostBlueskyPost(client, seedAccount, subjectUri, subjectCid)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}

/**
 * Hook to unrepost a Bluesky post.
 */
export function useUnrepostBlueskyPost(
  client: GRPCClient | undefined,
  options?: UseMutationOptions<void, Error, {seedAccount: string; uri: string}>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({seedAccount, uri}) => {
      if (!client) throw new Error('No client')
      return unrepostBlueskyPost(client, seedAccount, uri)
    },
    onSuccess: (_, {seedAccount}) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLUESKY_TIMELINE, seedAccount],
      })
    },
    ...options,
  })
}
