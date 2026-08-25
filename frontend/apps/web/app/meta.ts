export const defaultSpaceIcon = '/favicon.png'

export function defaultPageMeta(title: string) {
  return () => [
    {title},
    {
      tagName: 'link',
      rel: 'icon',
      href: defaultSpaceIcon,
      type: 'image/png',
    },
  ]
}
