import {unpackHmId} from './utils'

export async function resolveHypermediaUrl(url: string) {
  const response = await fetch(url, {
    method: 'OPTIONS',
  })
  if (response.status === 200) {
    const rawId = response.headers.get('x-hypermedia-id')
    const id = rawId ? decodeURIComponent(rawId) : null
    const version = response.headers.get('x-hypermedia-version')
    const encodedTitle = response.headers.get('x-hypermedia-title')
    const title = encodedTitle ? decodeURIComponent(encodedTitle) : null
    const rawTarget = response.headers.get('x-hypermedia-target')
    const target = rawTarget ? unpackHmId(decodeURIComponent(rawTarget)) : null
    const rawAuthors = response.headers.get('x-hypermedia-authors')
    const authors = rawAuthors
      ? decodeURIComponent(rawAuthors)
          .split(',')
          .map((author) => unpackHmId(author))
      : null
    const type = response.headers.get('x-hypermedia-type')
    if (id) {
      return {id, hmId: unpackHmId(id), version, title, target, authors, type}
    }
    return null
  }
  return null
}
