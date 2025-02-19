export async function checkWebUrl(url: string) {
  /**
   
   * TODO ERIC
   * https://github.com/seed-hypermedia/seed/blob/509cc0e68e813d4b64b586a57bd256a5787b88e3/frontend/apps/desktop/src/app-web-importing.ts#L63
   * 
   * should return null or {
        contentType,
        mimeType,
        contentLength: headers['content-length']
          ? Number(headers['content-length'])
          : null,
        charset,
        headers,
        metaTags,
      }
   */
}

export async function resolveHypermediaUrl(url: string) {
  const response = await fetch(url, {
    method: "OPTIONS",
  });
  if (response.status === 200) {
    const id = response.headers.get("x-hypermedia-id");
    const version = response.headers.get("x-hypermedia-version");
    const title = response.headers.get("x-hypermedia-title");
    if (id && version) {
      return {id, version, title};
    }
  }
  return null;
}
