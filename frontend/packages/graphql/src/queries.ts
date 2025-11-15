/**
 * GraphQL Queries
 *
 * Defines GraphQL query strings for fetching resources.
 */

/**
 * Fragment for block content
 */
export const BLOCKS_CONTENT_FRAGMENT = `
  fragment BlocksContentFields on BlocksContent {
    rootBlockIds
    blocks {
      childrenIds
      childrenType
      block {
        id
        type
        ... on ParagraphBlock {
          text
          annotations {
            type
            starts
            ends
            ... on LinkAnnotation {
              link
            }
          }
        }
        ... on HeadingBlock {
          text
          annotations {
            type
            starts
            ends
            ... on LinkAnnotation {
              link
            }
          }
        }
        ... on CodeBlock {
          text
          language
        }
        ... on MathBlock {
          text
        }
        ... on ImageBlock {
          link
          text
          width
          name
        }
        ... on VideoBlock {
          link
          width
          name
        }
        ... on FileBlock {
          link
          size
          name
        }
        ... on ButtonBlock {
          link
          text
          alignment
        }
        ... on EmbedBlock {
          link
          view
        }
        ... on WebEmbedBlock {
          link
        }
        ... on NostrBlock {
          link
        }
      }
    }
  }
`

/**
 * Fragment for Profile
 */
export const PROFILE_FRAGMENT = `
  fragment ProfileFields on Profile {
    accountId
    name
  }
`

/**
 * Fragment for Document resource
 */
export const DOCUMENT_FRAGMENT = `
  fragment DocumentFields on Document {
    iri
    version
    account
    path
    name
    content {
      ...BlocksContentFields
    }
  }
`

/**
 * Fragment for Comment resource
 */
export const COMMENT_FRAGMENT = `
  fragment CommentFields on Comment {
    iri
    version
    id
    authorId
    author {
      ...ProfileFields
    }
    targetAccount
    targetPath
    replyParent
    content {
      ...BlocksContentFields
    }
  }
`

/**
 * Query to fetch a resource by IRI
 */
export const GET_RESOURCE_QUERY = `
  ${BLOCKS_CONTENT_FRAGMENT}
  ${PROFILE_FRAGMENT}
  ${DOCUMENT_FRAGMENT}
  ${COMMENT_FRAGMENT}

  query GetResource($iri: String!) {
    getResource(iri: $iri) {
      __typename
      iri
      version
      ... on Document {
        ...DocumentFields
      }
      ... on Comment {
        ...CommentFields
      }
    }
  }
`

/**
 * Query to list comments on a document
 */
export const LIST_COMMENTS_QUERY = `
  ${BLOCKS_CONTENT_FRAGMENT}
  ${PROFILE_FRAGMENT}
  ${COMMENT_FRAGMENT}
  ${DOCUMENT_FRAGMENT}

  query ListComments($iri: String!, $pageSize: Int, $pageToken: String) {
    getResource(iri: $iri) {
      __typename
      ... on Document {
        ...DocumentFields
        discussions(pageSize: $pageSize, pageToken: $pageToken) {
          ...CommentFields
        }
      }
    }
  }
`

/**
 * Health check query
 */
export const HELLO_QUERY = `
  query Hello {
    hello
  }
`
