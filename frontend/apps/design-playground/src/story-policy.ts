/** Count the complete catalogue and its policy fallbacks without mounting story components. */
export function countStories(stories: {title: string; args: Record<string, unknown>; source: string}[]): {
  total: number
  storybookOnly: number
} {
  return {
    total: stories.length,
    storybookOnly: stories.filter(({title, args, source}) => inlineStoryReason(title, args, source)).length,
  }
}

/** Return a story's module source without the other named story exports. */
export function storySource(moduleSource: string, exportName: string): string {
  const declarations = [...moduleSource.matchAll(/^export (?:const|function) (\w+)\b/gm)]
  let result = ''
  let cursor = 0
  for (const declaration of declarations) {
    const start = declaration.index!
    const nextExport = moduleSource.slice(start + declaration[0].length).search(/^export /m)
    const end = nextExport === -1 ? moduleSource.length : start + declaration[0].length + nextExport
    if (declaration[1] === exportName) continue
    result += moduleSource.slice(cursor, start)
    cursor = end
  }
  return result + moduleSource.slice(cursor)
}

/** Close the public overlay inputs while leaving all other story args unchanged. */
export function closedOverlayArgs(args: Record<string, unknown>): Record<string, false> {
  return Object.fromEntries(
    ['open', 'defaultOpen', 'isOpen'].filter((name) => name in args).map((name) => [name, false]),
  )
}

/** Explain why a story requires its isolated Storybook document instead of the shared canvas. */
export function inlineStoryReason(title: string, args: Record<string, unknown>, source: string): string {
  if (title === 'Components/Toaster') return 'Global toast host; the shared host is demonstrated in Compositions.'
  if (title === 'Pages/DocumentPageParameters' || title === 'Pages/DocumentPagePermissions')
    return 'The page component opens a modal internally with no closed-state input.'
  if (title === 'Components/ImageCropDialog' && args.input)
    return 'A supplied crop input opens a modal immediately; the closed story remains inline.'
  if (/<[A-Z][\w.]*\b[^>]*\s(?:open|defaultOpen)(?:\s|>|=\{true\})/.test(source))
    return 'The story hardcodes an open overlay; its original behavior is preserved in Storybook.'
  return ''
}
