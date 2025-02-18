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
  /**
   * TODO ERIC
   * https://github.com/seed-hypermedia/seed/blob/509cc0e68e813d4b64b586a57bd256a5787b88e3/frontend/apps/desktop/src/models/web-links.ts#L93
   *
   * should return the metatags of the html page or null if the url is not a hypermedia page
   * example: {
   *  hypermedia_id: '123',
   *  hypermedia_version: '1.0',
   *  hypermedia_title: 'My Page',
   *  hypermedia_description: 'This is a description',
   *  hypermedia_image: 'ipfs://Qm123',
   *  hypermedia_url: 'https://hyper.media/hm/123',
   * }
   */
}
