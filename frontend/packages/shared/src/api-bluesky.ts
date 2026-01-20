/**
 * Bluesky/AT Protocol API functions.
 *
 * This module provides functions for interacting with Bluesky through the Seed daemon.
 * Once the ATProto gRPC service is generated, this will use the generated client types.
 */

import {GRPCClient} from './grpc-client'

// Types for Bluesky API (these will be replaced by proto-generated types)

export interface BlueskyProfile {
  did: string
  handle: string
  displayName?: string
  description?: string
  avatar?: string
  banner?: string
  followersCount: number
  followsCount: number
  postsCount: number
  indexedAt?: Date
  viewerFollowing?: boolean
  viewerFollowedBy?: boolean
  viewerBlocking?: boolean
  viewerMuted?: boolean
}

export interface BlueskyConnection {
  seedAccount: string
  did: string
  handle: string
  pdsUrl: string
  isConnected: boolean
  connectTime?: Date
}

export interface BlueskyPost {
  uri: string
  cid: string
  author: BlueskyProfile
  text: string
  createdAt: Date
  indexedAt: Date
  replyCount: number
  repostCount: number
  likeCount: number
  viewerLiked?: boolean
  viewerReposted?: boolean
  viewerLikeUri?: string
  viewerRepostUri?: string
  embed?: BlueskyEmbed
}

export interface BlueskyEmbed {
  type: 'images' | 'external' | 'record' | 'recordWithMedia'
  images?: Array<{
    thumb: string
    fullsize: string
    alt: string
  }>
  external?: {
    uri: string
    title: string
    description: string
    thumb?: string
  }
  record?: BlueskyPost
}

export interface BlueskyFeedItem {
  post: BlueskyPost
  reply?: {
    root?: BlueskyPost
    parent?: BlueskyPost
  }
  reason?: {
    type: string
    by?: BlueskyProfile
    indexedAt?: Date
  }
}

export interface BlueskyNotification {
  uri: string
  cid: string
  author: BlueskyProfile
  reason: 'like' | 'repost' | 'follow' | 'mention' | 'reply' | 'quote'
  record?: unknown
  isRead: boolean
  indexedAt: Date
}

// API Functions

/**
 * Connect a Seed account to Bluesky using app password authentication.
 */
export async function connectBluesky(
  client: GRPCClient,
  seedAccount: string,
  identifier: string,
  appPassword: string,
  pdsUrl?: string,
): Promise<{connection: BlueskyConnection; profile: BlueskyProfile}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.connect({
  //   seedAccount,
  //   identifier,
  //   appPassword,
  //   pdsUrl,
  // })
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Disconnect a Bluesky account.
 */
export async function disconnectBluesky(
  client: GRPCClient,
  seedAccount: string,
): Promise<void> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.disconnect({seedAccount})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Get connection status for a Seed account.
 */
export async function getBlueskyConnectionStatus(
  client: GRPCClient,
  seedAccount: string,
): Promise<BlueskyConnection | null> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.getConnectionStatus({seedAccount})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * List all Bluesky connections.
 */
export async function listBlueskyConnections(
  client: GRPCClient,
): Promise<BlueskyConnection[]> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.listConnections({})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Resolve a Bluesky handle to a DID.
 */
export async function resolveBlueskyHandle(
  client: GRPCClient,
  handle: string,
): Promise<string> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.resolveHandle({handle})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Get a Bluesky profile.
 */
export async function getBlueskyProfile(
  client: GRPCClient,
  seedAccount: string,
  actor: string,
): Promise<BlueskyProfile> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.getProfile({seedAccount, actor})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Search for Bluesky actors.
 */
export async function searchBlueskyActors(
  client: GRPCClient,
  seedAccount: string,
  query: string,
  options?: {limit?: number; cursor?: string},
): Promise<{actors: BlueskyProfile[]; cursor?: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.searchActors({seedAccount, query, ...options})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Get the timeline for a connected account.
 */
export async function getBlueskyTimeline(
  client: GRPCClient,
  seedAccount: string,
  options?: {limit?: number; cursor?: string; algorithm?: string},
): Promise<{feed: BlueskyFeedItem[]; cursor?: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.getTimeline({seedAccount, ...options})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Create a post on Bluesky.
 */
export async function createBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  text: string,
  options?: {
    replyTo?: {
      rootUri: string
      rootCid: string
      parentUri: string
      parentCid: string
    }
    langs?: string[]
  },
): Promise<{uri: string; cid: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.createPost({seedAccount, text, ...options})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Delete a post from Bluesky.
 */
export async function deleteBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  uri: string,
): Promise<void> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.deletePost({seedAccount, uri})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Follow a Bluesky account.
 */
export async function followBlueskyAccount(
  client: GRPCClient,
  seedAccount: string,
  subject: string,
): Promise<{uri: string; cid: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.follow({seedAccount, subject})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Unfollow a Bluesky account.
 */
export async function unfollowBlueskyAccount(
  client: GRPCClient,
  seedAccount: string,
  subject: string,
): Promise<void> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.unfollow({seedAccount, subject})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Like a post on Bluesky.
 */
export async function likeBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  subjectUri: string,
  subjectCid: string,
): Promise<{uri: string; cid: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.like({seedAccount, subjectUri, subjectCid})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Unlike a post on Bluesky.
 */
export async function unlikeBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  uri: string,
): Promise<void> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.unlike({seedAccount, uri})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Repost a post on Bluesky.
 */
export async function repostBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  subjectUri: string,
  subjectCid: string,
): Promise<{uri: string; cid: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.repost({seedAccount, subjectUri, subjectCid})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Remove a repost.
 */
export async function unrepostBlueskyPost(
  client: GRPCClient,
  seedAccount: string,
  uri: string,
): Promise<void> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.unrepost({seedAccount, uri})
  throw new Error('ATProto gRPC service not yet available')
}

/**
 * Get notifications for a connected account.
 */
export async function getBlueskyNotifications(
  client: GRPCClient,
  seedAccount: string,
  options?: {limit?: number; cursor?: string},
): Promise<{notifications: BlueskyNotification[]; cursor?: string}> {
  // TODO: Call the ATProto gRPC service once generated
  // return client.atproto.getNotifications({seedAccount, ...options})
  throw new Error('ATProto gRPC service not yet available')
}
