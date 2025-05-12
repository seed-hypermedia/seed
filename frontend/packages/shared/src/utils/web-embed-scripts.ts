export function loadInstagramScript() {
  if (!document.getElementById('instagram-embed-script')) {
    const script = document.createElement('script')
    script.id = 'instagram-embed-script'
    script.src = 'https://www.instagram.com/embed.js'
    script.async = true
    script.defer = true
    document.body.appendChild(script)
  }
}

export function loadTwitterScript(): Promise<any> {
  if ((window as any).twttr) return Promise.resolve(window.twttr)

  const existing = document.getElementById('twitter-widgets-script')
  if (existing) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if ((window as any).twttr) {
          clearInterval(check)
          resolve(window.twttr)
        }
      }, 50)
    })
  }

  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.id = 'twitter-widgets-script'
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    script.onload = () => resolve((window as any).twttr)
    document.body.appendChild(script)
  })
}

export function generateInstagramEmbedHtml(url: string): string {
  const cleanUrl = url.split('?')[0].replace(/\/$/, '') // strip params and trailing slash
  const permalink = `${cleanUrl}/?utm_source=ig_embed&utm_campaign=loading`

  return `
      <blockquote
        class="instagram-media"
        data-instgrm-permalink="${permalink}"
        data-instgrm-captioned
        data-instgrm-version="14"
        style="background:#FFF; border:0; border-radius:3px;
               box-shadow:0 0 1px 0 rgba(0,0,0,0.5),
                           0 1px 10px 0 rgba(0,0,0,0.15);
               margin: 1px; max-width:540px; min-width:326px;
               padding:0; width:calc(100% - 2px);">
      </blockquote>
    `
}
