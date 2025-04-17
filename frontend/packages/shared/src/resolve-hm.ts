export async function resolveHypermediaUrl(url: string) {
  const response = await fetch(url, {
    method: 'OPTIONS',
  })
  if (response.status === 200) {
    const id = response.headers.get('x-hypermedia-id')
    const version = response.headers.get('x-hypermedia-version')
    const title = response.headers.get('x-hypermedia-title')
    if (id && version) {
      return {id, version, title}
    }
  }
  return null
}
