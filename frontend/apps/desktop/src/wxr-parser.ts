/**
 * WordPress WXR (eXtended RSS) parser.
 * Parses WordPress export files and extracts authors, posts, and media.
 */
import * as cheerio from 'cheerio'
import {normalizeAuthorLogin} from './wxr-import-utils'

export interface WXRAuthor {
  login: string
  email: string
  displayName: string
  firstName?: string
  lastName?: string
}

export interface WXRPost {
  id: number
  title: string
  slug: string
  link: string
  content: string
  excerpt: string
  status: 'publish' | 'draft' | 'private' | 'pending' | 'future' | 'trash'
  type: 'post' | 'page' | 'attachment' | string
  authorLogin: string
  pubDate?: string
  postDate?: string
  postDateGmt?: string
  parentId?: number
  menuOrder?: number
  attachmentUrl?: string
  categories: string[]
  tags: string[]
}

export interface WXRMedia {
  id: number
  url: string
  title: string
  mimeType?: string
  parentId?: number
}

export interface WXRParseResult {
  siteTitle: string
  siteUrl: string
  authors: WXRAuthor[]
  posts: WXRPost[]
  pages: WXRPost[]
  attachments: WXRMedia[]
}

/**
 * Parse a WordPress WXR export file.
 */
export function parseWXR(xml: string): WXRParseResult {
  const $ = cheerio.load(xml, {xml: true})

  const channel = $('channel')

  const siteTitle = channel.children('title').first().text().trim()
  const siteUrl = channel.children('link').first().text().trim()

  // Parse authors from wp:author elements using filter instead of CSS selector.
  const authors: WXRAuthor[] = []
  channel.children().each((_i, el) => {
    const tagName = getTagName(el)
    if (tagName === 'wp:author' || tagName === 'author') {
      const $el = $(el)
      const login = normalizeAuthorLogin(getChildText($, $el, 'wp:author_login'))
      if (login) {
        authors.push({
          login,
          email: getChildText($, $el, 'wp:author_email') || '',
          displayName: getChildText($, $el, 'wp:author_display_name') || login,
          firstName: getChildText($, $el, 'wp:author_first_name') || undefined,
          lastName: getChildText($, $el, 'wp:author_last_name') || undefined,
        })
      }
    }
  })

  // Parse items (posts, pages, attachments).
  const posts: WXRPost[] = []
  const pages: WXRPost[] = []
  const attachments: WXRMedia[] = []

  channel.children('item').each((_i, el) => {
    const $item = $(el)

    const postType = getChildText($, $item, 'wp:post_type') || 'post'
    const postId = parseInt(getChildText($, $item, 'wp:post_id') || '0', 10)
    const title = $item.children('title').text().trim()
    const content = getChildText($, $item, 'content:encoded') || getChildText($, $item, 'encoded')
    const excerpt = getChildText($, $item, 'excerpt:encoded') || ''
    const status = (getChildText($, $item, 'wp:status') as WXRPost['status']) || 'publish'
    const authorLogin = normalizeAuthorLogin(
      getChildText($, $item, 'dc:creator') || getChildText($, $item, 'creator') || '',
    )
    const pubDate = $item.children('pubDate').text().trim() || undefined
    const postDate = getChildText($, $item, 'wp:post_date') || undefined
    const postDateGmt = getChildText($, $item, 'wp:post_date_gmt') || undefined
    const parentId = parseInt(getChildText($, $item, 'wp:post_parent') || '0', 10) || undefined
    const menuOrder = parseInt(getChildText($, $item, 'wp:menu_order') || '0', 10) || undefined
    const slug = getChildText($, $item, 'wp:post_name') || ''
    const link = $item.children('link').text().trim()
    const attachmentUrl = getChildText($, $item, 'wp:attachment_url') || undefined

    // Parse categories and tags.
    const categories: string[] = []
    const tags: string[] = []
    $item.children('category').each((_j, catEl) => {
      const $cat = $(catEl)
      const domain = $cat.attr('domain')
      const nicename = $cat.attr('nicename')
      const catText = $cat.text().trim()
      if (domain === 'category' && nicename) {
        categories.push(catText)
      } else if (domain === 'post_tag' && nicename) {
        tags.push(catText)
      }
    })

    if (postType === 'attachment') {
      attachments.push({
        id: postId,
        url: attachmentUrl || '',
        title,
        parentId,
      })
    } else {
      const post: WXRPost = {
        id: postId,
        title,
        slug,
        link,
        content,
        excerpt,
        status,
        type: postType,
        authorLogin,
        pubDate,
        postDate,
        postDateGmt,
        parentId,
        menuOrder,
        attachmentUrl,
        categories,
        tags,
      }

      if (postType === 'page') {
        pages.push(post)
      } else if (postType === 'post') {
        posts.push(post)
      }
    }
  })

  return {
    siteTitle,
    siteUrl,
    authors,
    posts,
    pages,
    attachments,
  }
}

/**
 * Get the tag name of an element, handling namespaced tags.
 */
function getTagName(el: any): string {
  if (el.type === 'tag' || el.type === 'script' || el.type === 'style') {
    return el.name || ''
  }
  return ''
}

/**
 * Get text content from a child element by tag name (handles namespaced tags).
 * Uses DOM traversal instead of CSS selectors to avoid namespace issues.
 */
function getChildText(
  $: ReturnType<typeof cheerio.load>,
  $parent: ReturnType<ReturnType<typeof cheerio.load>>,
  tagName: string,
): string {
  let result = ''

  $parent.children().each((_i, el) => {
    const elTagName = getTagName(el)
    // Match exact tag name or just the local part after the colon
    if (elTagName === tagName || elTagName.endsWith(':' + tagName.split(':').pop())) {
      result = $(el).text().trim()
      return false // break the loop
    }
  })

  // Handle CDATA if present
  if (result.includes('<![CDATA[')) {
    result = result.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
  }

  return result.trim()
}

/**
 * Build a map of author login to author info for quick lookup.
 */
export function buildAuthorMap(authors: WXRAuthor[]): Map<string, WXRAuthor> {
  const map = new Map<string, WXRAuthor>()
  for (const author of authors) {
    map.set(author.login, author)
  }
  return map
}

/**
 * Extract unique author logins from posts.
 */
export function extractUniqueAuthors(posts: WXRPost[]): Set<string> {
  const logins = new Set<string>()
  for (const post of posts) {
    if (post.authorLogin) {
      logins.add(post.authorLogin)
    }
  }
  return logins
}
