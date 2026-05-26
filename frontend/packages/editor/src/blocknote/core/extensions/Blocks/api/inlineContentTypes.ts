export type Styles = {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  textColor?: string
  backgroundColor?: string
  textSize?: string
  textFamily?: string
}

export type ToggledStyle = {
  [K in keyof Styles]-?: Required<Styles>[K] extends true ? K : never
}[keyof Styles]

/** Marks that carry a CSS color value */
export type ColorStyle = 'textColor' | 'backgroundColor'

/** Marks that carry a font size or family. */
export type FontStyle = 'textSize' | 'textFamily'

/** All string valued styles. Useful when the distinction
 * between color and font marks doesn't matter. */
export type StringStyle = ColorStyle | FontStyle

export type StyledText = {
  type: 'text'
  text: string
  styles: Styles
}

export type BNLink = {
  type: 'link'
  href: string
  content: StyledText[]
}

export type InlineEmbed = {
  type: 'inline-embed'
  link: string
}

export type PartialLink = Omit<BNLink, 'content'> & {
  content: string | BNLink['content']
}

export type InlineContent = StyledText | BNLink | InlineEmbed
export type PartialInlineContent = StyledText | PartialLink
