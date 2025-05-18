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
  uploadLocalFile: (path: string) => Promise<string | null>,
): Promise<PartialMessage<Block>[]> {
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
              const uploadedCID = await uploadLocalFile(absoluteImageUrl)
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
            const uploadedCID = await uploadLocalFile(absoluteImageUrl)
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
