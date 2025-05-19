import {PartialMessage} from '@bufbuild/protobuf'
import * as cheerio from 'cheerio'
import {nanoid} from 'nanoid'
import {resolve} from 'path'
import {Block} from './client'
import {codePointLength} from './client/unicode'
import {HMAnnotation} from './hm-types'

export async function htmlToBlocks(
  html: string,
  htmlPath: string,
  opts: {
    uploadLocalFile?: (path: string) => Promise<string | null>
    resolveHMLink?: (href: string) => Promise<string | null>
  } = {},
): Promise<PartialMessage<Block>[]> {
  const {uploadLocalFile, resolveHMLink} = opts
  const $ = cheerio.load(html)
  const blocks: PartialMessage<Block>[] = []

  await Promise.all(
    $('body')
      .children()
      .map(async (_, el) => {
        const $el = $(el)

        if ($el.is('p')) {
          const text = $el.text().trim()
          if (text) {
            const annotations: HMAnnotation[] = []
            let pos = 0

            // Find all bold tags and create annotations
            $el.find('b, strong').each((_, boldEl) => {
              const $bold = $(boldEl)
              const boldText = $bold.text()
              const startPos = text.indexOf(boldText, pos)
              if (startPos !== -1) {
                const startOffset = codePointLength(text.slice(0, startPos))
                const endOffset = startOffset + codePointLength(boldText)
                annotations.push({
                  type: 'Bold',
                  starts: [startOffset],
                  ends: [endOffset],
                })
                pos = startPos + boldText.length
              }
            })

            // Find all link tags and create annotations
            await Promise.all(
              $el.find('a').map(async (_, linkEl) => {
                const $link = $(linkEl)
                const linkText = $link.text()
                const href = $link.attr('href')
                const startPos = text.indexOf(linkText, pos)
                if (startPos !== -1 && href) {
                  const startOffset = codePointLength(text.slice(0, startPos))
                  const endOffset = startOffset + codePointLength(linkText)
                  console.log('~~ found link', href)
                  const resolvedLink = resolveHMLink
                    ? await resolveHMLink(href)
                    : href
                  if (resolvedLink) {
                    annotations.push({
                      type: 'Link',
                      starts: [startOffset],
                      ends: [endOffset],
                      link: resolvedLink,
                    })
                  }
                  pos = startPos + linkText.length
                }
              }),
            )

            blocks.push({
              id: nanoid(8),
              type: 'Paragraph',
              text,
              revision: nanoid(8),
              link: '',
              attributes: {},
              annotations,
            })
          }
        } else if ($el.is('figure')) {
          const img = $el.find('img')
          if (img.length) {
            const src = img.attr('src')
            if (src) {
              const absoluteImageUrl = resolve(htmlPath, '..', src)
              const uploadedCID =
                uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
              if (uploadedCID) {
                blocks.push({
                  id: nanoid(8),
                  type: 'Image',
                  link: `ipfs://${uploadedCID}`,
                  revision: nanoid(8),
                  text: '',
                  attributes: {},
                  annotations: [],
                })
              }
            }
          }
        } else if ($el.is('img')) {
          const src = $el.attr('src')
          if (src) {
            const absoluteImageUrl = resolve(htmlPath, '..', src)
            const uploadedCID =
              uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
            if (uploadedCID) {
              blocks.push({
                id: nanoid(8),
                type: 'Image',
                link: `ipfs://${uploadedCID}`,
                revision: nanoid(8),
                text: '',
                attributes: {},
                annotations: [],
              })
            }
          }
        }
      }),
  )

  return blocks
}
