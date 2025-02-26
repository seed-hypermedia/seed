export const defaultSiteIcon = '/favicon.png'

export function defaultPageMeta(title: string) {
  return () => [
    {title},
    {
      tagName: 'link',
      rel: 'icon',
      href: defaultSiteIcon,
      type: 'image/png',
    },
  ]
}
