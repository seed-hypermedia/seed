import {describe, expect, it, vi} from 'vitest'
import {HMAnnotation, HMBlock} from '..'
import {htmlToBlocks} from '../html-to-blocks'

describe('htmlToBlocks', () => {
  it('converts paragraphs to blocks', async () => {
    const html = '<p>Hello world</p><p>Another paragraph</p>'
    const uploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(2)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'Hello world',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Paragraph',
      text: 'Another paragraph',
    })
  })

  it('converts images to blocks with figure wrapper', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(uploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts images to blocks', async () => {
    const html = '<img src="test.jpg" />'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
    })
    expect(uploadLocalFile).toHaveBeenCalledWith('/test/test.jpg')
  })

  it('converts bold text to annotations (b) tag', async () => {
    const html = '<p>hello <b>world</b>!</p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts bold text to annotations (strong) tag', async () => {
    const html = '<p>hello <strong>world</strong>!</p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts italic text to annotations (em) tag', async () => {
    const html = '<p>hello <em>world</em>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Italic',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts underline text to annotations (u) tag', async () => {
    const html = '<p>hello <u>world</u>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Underline',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts strikethrough text to annotations (s) tag', async () => {
    const html = '<p>hello <s>world</s>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Strike',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts strikethrough text to annotations (del) tag', async () => {
    const html = '<p>hello <del>world</del>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Strike',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts code text to annotations (code) tag', async () => {
    const html = '<p>hello <code>world</code>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Code',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('supports combined bold+italic annotations', async () => {
    const html = '<p>hello <strong><em>world</em></strong>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
        {
          type: 'Italic',
          starts: [6],
          ends: [11],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('supports overlapping bold+italic annotations', async () => {
    const html = '<p>hello <strong>good <em>world</em></strong>!</p>'
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'hello good world!',
      annotations: [
        {
          type: 'Bold',
          starts: [6],
          ends: [16],
        } satisfies HMAnnotation,
        {
          type: 'Italic',
          starts: [11],
          ends: [16],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts bold text to annotations with utf-8 code point offsets', async () => {
    const html = '<p>😄<strong>a</strong></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄a',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Bold',
          starts: [1],
          ends: [2],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts text with link to annotation', async () => {
    const html = '<p>😄<a href="https://github.com">foobar</a></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄foobar',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Link',
          starts: [1],
          ends: [7],
          link: 'https://github.com',
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('converts text with hm link to annotation', async () => {
    const html = '<p>😄<a href="https://github.com">foobar</a></p>'
    const resolveHMLink = vi
      .fn()
      .mockResolvedValue(Promise.resolve('hm://foobar/baz'))
    const blocks = await htmlToBlocks(html, '/test/path', {resolveHMLink})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '😄foobar',
      link: '',
      revision: blocks[0].block.revision as string,
      id: blocks[0].block.id as string,
      annotations: [
        {
          type: 'Link',
          starts: [1],
          ends: [7],
          link: 'hm://foobar/baz',
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('handles paragraphs with both links and bolds', async () => {
    const html =
      '<p>foo <a href="https://github.com">bar <strong>baz</strong></a> <strong>qux</strong></p>'
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo bar baz qux',
      annotations: [
        {
          type: 'Link',
          starts: [4],
          ends: [11],
          link: 'https://github.com',
        } satisfies HMAnnotation,
        {
          type: 'Bold',
          starts: [8],
          ends: [11],
        } satisfies HMAnnotation,
        {
          type: 'Bold',
          starts: [12],
          ends: [15],
        } satisfies HMAnnotation,
      ],
    } satisfies Partial<HMBlock>)
  })

  it('handles multiple paragraphs in correct order', async () => {
    const html = '<p>foo</p><p><strong>bar</strong></p><p>baz</p>'
    const uploadLocalFile = vi.fn()
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(3)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Paragraph',
      text: 'bar',
      annotations: [
        {
          type: 'Bold',
          starts: [0],
          ends: [3],
        } satisfies HMAnnotation,
      ],
    })
    expect(blocks[2].block).toMatchObject({
      type: 'Paragraph',
      text: 'baz',
    })
  })

  it('handles empty paragraphs', async () => {
    const html = '<p></p><p>  </p>'
    const uploadLocalFile = vi.fn()

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(0)
  })

  it('handles failed image uploads', async () => {
    const html = '<figure><img src="test.jpg" /></figure>'
    const uploadLocalFile = vi.fn().mockResolvedValue(null)

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(0)
  })

  it('handles main image', async () => {
    const html = `<div class="main-image">
      <div class="post-thumbnail full-width-image">
        <img width="2048" height="1152" src="../images/984ad815087f0d2dc8d8588ca8d5459b.jpg">
      </div>
      <span class="aft-image-caption">
        <p>foo <strong>bar</strong></p>
      </span>
    </div>`
    const uploadLocalFile = vi.fn().mockResolvedValue('TestCID')
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://TestCID',
      text: 'foo bar',
      annotations: [
        {
          type: 'Bold',
          starts: [4],
          ends: [7],
        } satisfies HMAnnotation,
      ],
    })
  })

  it('handles instagram embed', async () => {
    const html = `
      <blockquote class="instagram-media" data-instgrm-captioned="" data-instgrm-permalink="https://www.instagram.com/reel/DHmR21qs2cy/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14" style=" background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);"><div style="padding:16px;"> <a href="https://www.instagram.com/reel/DHmR21qs2cy/?utm_source=ig_embed&amp;utm_campaign=loading" style=" background:#FFFFFF; line-height:0; padding:0 0; text-align:center; text-decoration:none; width:100%;" target="_blank"> <div style=" display: flex; flex-direction: row; align-items: center;"> <div style="background-color: #F4F4F4; border-radius: 50%; flex-grow: 0; height: 40px; margin-right: 14px; width: 40px;"></div> <div style="display: flex; flex-direction: column; flex-grow: 1; justify-content: center;"> <div style=" background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; margin-bottom: 6px; width: 100px;"></div> <div style=" background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; width: 60px;"></div></div></div><div style="padding: 19% 0;"></div> <div style="display:block; height:50px; margin:0 auto 12px; width:50px;"><svg width="50px" height="50px" viewBox="0 0 60 60" version="1.1" xmlns="https://www.w3.org/2000/svg" xmlns:xlink="https://www.w3.org/1999/xlink"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g transform="translate(-511.000000, -20.000000)" fill="#000000"><g><path d="M556.869,30.41 C554.814,30.41 553.148,32.076 553.148,34.131 C553.148,36.186 554.814,37.852 556.869,37.852 C558.924,37.852 560.59,36.186 560.59,34.131 C560.59,32.076 558.924,30.41 556.869,30.41 M541,60.657 C535.114,60.657 530.342,55.887 530.342,50 C530.342,44.114 535.114,39.342 541,39.342 C546.887,39.342 551.658,44.114 551.658,50 C551.658,55.887 546.887,60.657 541,60.657 M541,33.886 C532.1,33.886 524.886,41.1 524.886,50 C524.886,58.899 532.1,66.113 541,66.113 C549.9,66.113 557.115,58.899 557.115,50 C557.115,41.1 549.9,33.886 541,33.886 M565.378,62.101 C565.244,65.022 564.756,66.606 564.346,67.663 C563.803,69.06 563.154,70.057 562.106,71.106 C561.058,72.155 560.06,72.803 558.662,73.347 C557.607,73.757 556.021,74.244 553.102,74.378 C549.944,74.521 548.997,74.552 541,74.552 C533.003,74.552 532.056,74.521 528.898,74.378 C525.979,74.244 524.393,73.757 523.338,73.347 C521.94,72.803 520.942,72.155 519.894,71.106 C518.846,70.057 518.197,69.06 517.654,67.663 C517.244,66.606 516.755,65.022 516.623,62.101 C516.479,58.943 516.448,57.996 516.448,50 C516.448,42.003 516.479,41.056 516.623,37.899 C516.755,34.978 517.244,33.391 517.654,32.338 C518.197,30.938 518.846,29.942 519.894,28.894 C520.942,27.846 521.94,27.196 523.338,26.654 C524.393,26.244 525.979,25.756 528.898,25.623 C532.057,25.479 533.004,25.448 541,25.448 C548.997,25.448 549.943,25.479 553.102,25.623 C556.021,25.756 557.607,26.244 558.662,26.654 C560.06,27.196 561.058,27.846 562.106,28.894 C563.154,29.942 563.803,30.938 564.346,32.338 C564.756,33.391 565.244,34.978 565.378,37.899 C565.522,41.056 565.552,42.003 565.552,50 C565.552,57.996 565.522,58.943 565.378,62.101 M570.82,37.631 C570.674,34.438 570.167,32.258 569.425,30.349 C568.659,28.377 567.633,26.702 565.965,25.035 C564.297,23.368 562.623,22.342 560.652,21.575 C558.743,20.834 556.562,20.326 553.369,20.18 C550.169,20.033 549.148,20 541,20 C532.853,20 531.831,20.033 528.631,20.18 C525.438,20.326 523.257,20.834 521.349,21.575 C519.376,22.342 517.703,23.368 516.035,25.035 C514.368,26.702 513.342,28.377 512.574,30.349 C511.834,32.258 511.326,34.438 511.181,37.631 C511.035,40.831 511,41.851 511,50 C511,58.147 511.035,59.17 511.181,62.369 C511.326,65.562 511.834,67.743 512.574,69.651 C513.342,71.625 514.368,73.296 516.035,74.965 C517.703,76.634 519.376,77.658 521.349,78.425 C523.257,79.167 525.438,79.673 528.631,79.82 C531.831,79.965 532.853,80.001 541,80.001 C549.148,80.001 550.169,79.965 553.369,79.82 C556.562,79.673 558.743,79.167 560.652,78.425 C562.623,77.658 564.297,76.634 565.965,74.965 C567.633,73.296 568.659,71.625 569.425,69.651 C570.167,67.743 570.674,65.562 570.82,62.369 C570.966,59.17 571,58.147 571,50 C571,41.851 570.966,40.831 570.82,37.631"></path></g></g></g></svg></div><div style="padding-top: 8px;"> <div style=" color:#3897f0; font-family:Arial,sans-serif; font-size:14px; font-style:normal; font-weight:550; line-height:18px;">Ver esta publicación en Instagram</div></div><div style="padding: 12.5% 0;"></div> <div style="display: flex; flex-direction: row; margin-bottom: 14px; align-items: center;"><div> <div style="background-color: #F4F4F4; border-radius: 50%; height: 12.5px; width: 12.5px; transform: translateX(0px) translateY(7px);"></div> <div style="background-color: #F4F4F4; height: 12.5px; transform: rotate(-45deg) translateX(3px) translateY(1px); width: 12.5px; flex-grow: 0; margin-right: 14px; margin-left: 2px;"></div> <div style="background-color: #F4F4F4; border-radius: 50%; height: 12.5px; width: 12.5px; transform: translateX(9px) translateY(-18px);"></div></div><div style="margin-left: 8px;"> <div style=" background-color: #F4F4F4; border-radius: 50%; flex-grow: 0; height: 20px; width: 20px;"></div> <div style=" width: 0; height: 0; border-top: 2px solid transparent; border-left: 6px solid #f4f4f4; border-bottom: 2px solid transparent; transform: translateX(16px) translateY(-4px) rotate(30deg)"></div></div><div style="margin-left: auto;"> <div style=" width: 0px; border-top: 8px solid #F4F4F4; border-right: 8px solid transparent; transform: translateY(16px);"></div> <div style=" background-color: #F4F4F4; flex-grow: 0; height: 12px; width: 16px; transform: translateY(-4px);"></div> <div style=" width: 0; height: 0; border-top: 8px solid #F4F4F4; border-left: 8px solid transparent; transform: translateY(-4px) translateX(8px);"></div></div></div> <div style="display: flex; flex-direction: column; flex-grow: 1; justify-content: center; margin-bottom: 24px;"> <div style=" background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; margin-bottom: 6px; width: 224px;"></div> <div style=" background-color: #F4F4F4; border-radius: 4px; flex-grow: 0; height: 14px; width: 144px;"></div></div></a><p style=" color:#c9c8cd; font-family:Arial,sans-serif; font-size:14px; line-height:17px; margin-bottom:0; margin-top:8px; overflow:hidden; padding:8px 0 7px; text-align:center; text-overflow:ellipsis; white-space:nowrap;"><a href="https://www.instagram.com/reel/DHmR21qs2cy/?utm_source=ig_embed&amp;utm_campaign=loading" style=" color:#c9c8cd; font-family:Arial,sans-serif; font-size:14px; font-style:normal; font-weight:normal; line-height:17px; text-decoration:none;" target="_blank">Una publicación compartida por Bloque San Ildefonso 20 (@bloque_sanildefonso20)</a></p></div></blockquote>
      <script async="" src="../images/50707bd9e577548c78bce159272d7e1a.js"></script>
    `
    const uploadLocalFile = vi.fn()
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'WebEmbed',
      link: 'https://www.instagram.com/reel/DHmR21qs2cy/?utm_source=ig_embed&utm_campaign=loading',
    })
  })

  it('handles twitter embed', async () => {
    const html = `
    <blockquote class="twitter-tweet">
<p dir="ltr" lang="ca">Dispositivo de policial municipal de 4 furgones para desahuciar a una vecina de Lavapiés, Zohra, del número 31 de la calle Zurita. Calle cortada <a href="https://t.co/xY0yflxwfh">pic.twitter.com/xY0yflxwfh</a></p>
— xLavapiés (@xlavapies) <a href="https://twitter.com/xlavapies/status/1816008976179351682?ref_src=twsrc%5Etfw">July 24, 2024</a></blockquote>
<p><script async="" src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></p>
`
    const blocks = await htmlToBlocks(html, '/test/path', {})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'WebEmbed',
      link: 'https://twitter.com/xlavapies/status/1816008976179351682',
    })
  })

  it('handles youtube embed', async () => {
    const html = `
      <p><iframe title="YouTube video player" src="https://www.youtube.com/embed/3cWPFs-qGzc?si=fP27uHHxy7AIpa0g" width="560" height="315" frameborder="0" allowfullscreen="allowfullscreen"></iframe></p>
      <p>&nbsp;</p>
    `
    const uploadLocalFile = vi.fn()
    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Video',
      link: 'https://www.youtube.com/embed/3cWPFs-qGzc',
    })
  })

  it('handles image with caption', async () => {
    const html = `
        <figure class="wp-block-image size-large">
      <img
        src="test.jpg"
      />
      <figcaption class="wp-element-caption">
        foo <b>bar</b>
      </figcaption>
    </figure>`
    const uploadLocalFile = vi.fn().mockResolvedValue('QmTestCID')

    const blocks = await htmlToBlocks(html, '/test/path', {uploadLocalFile})

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Image',
      link: 'ipfs://QmTestCID',
      text: 'foo bar',
      annotations: [
        {
          type: 'Bold',
          starts: [4],
          ends: [7],
        } satisfies HMAnnotation,
      ],
    })
  })

  it('handles basic hierarchy with headings', async () => {
    const html = `
        <h1>Hello</h1>
        <p>World</p>
        <h2>Foo</h2>
        <p>Bar</p>
    `
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Heading',
      text: 'Hello',
    })
    expect(blocks[0].children?.length).toBe(2)
    expect(blocks[0].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'World',
    })
    expect(blocks[0].children?.[1].block).toMatchObject({
      type: 'Heading',
      text: 'Foo',
    })
    expect(blocks[0].children?.[1].children?.length).toBe(1)
    expect(blocks[0].children?.[1].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'Bar',
    })
  })

  it('handles multiple headings', async () => {
    const html = `
        <h3>Hello</h3>
        <p>foo</p>
        <p>f2</p>
        <h3>World</h3>
        <p>bar</p>
    `
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks).toHaveLength(2)
    expect(blocks[0].block).toMatchObject({
      type: 'Heading',
      text: 'Hello',
    })
    expect(blocks[0].children?.length).toBe(2)
    expect(blocks[0].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo',
    })
    expect(blocks[0].children?.[1].block).toMatchObject({
      type: 'Paragraph',
      text: 'f2',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Heading',
      text: 'World',
    })
    expect(blocks[1].children?.length).toBe(1)
    expect(blocks[1].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'bar',
    })
  })

  it('handles headings from fully bold paragraphs (em)', async () => {
    const html = `
    <h3>Hello</h3>
    <p>foo</p>
    <p><em> bar    </em>  </p>
    <p>bar</p>
`
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Heading',
      text: 'Hello',
    })
    expect(blocks[0].children?.length).toBe(2)
    expect(blocks[0].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo',
    })
    expect(blocks[0].children?.[1].block).toMatchObject({
      type: 'Heading',
      text: 'bar',
    })
    expect(blocks[0].children?.[1].children?.length).toBe(1)
    expect(blocks[0].children?.[1].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'bar',
    })
  })

  it('handles headings from fully bold paragraphs (strong)', async () => {
    const html = `
    <h3>Hello</h3>
    <p>foo</p>
    <p>  <strong> bar    </strong>  </p>
    <p>bar</p>
`
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks).toHaveLength(1)
    expect(blocks[0].block).toMatchObject({
      type: 'Heading',
      text: 'Hello',
    })
    expect(blocks[0].children?.length).toBe(2)
    expect(blocks[0].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'foo',
    })
    expect(blocks[0].children?.[1].block).toMatchObject({
      type: 'Heading',
      text: 'bar',
    })
    expect(blocks[0].children?.[1].children?.length).toBe(1)
    expect(blocks[0].children?.[1].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: 'bar',
    })
  })

  it('handles headings from fully bold paragraphs (strong) with multiple paragraphs', async () => {
    const html = `<p>1</p>

<p><strong>foo</strong></p>

<p>2</p>`
    const blocks = await htmlToBlocks(html, '/test/path', {})
    expect(blocks).toHaveLength(2)
    expect(blocks[0].block).toMatchObject({
      type: 'Paragraph',
      text: '1',
    })
    expect(blocks[1].block).toMatchObject({
      type: 'Heading',
      text: 'foo',
    })
    expect(blocks[1].children?.length).toBe(1)
    expect(blocks[1].children?.[0].block).toMatchObject({
      type: 'Paragraph',
      text: '2',
    })
  })
})
