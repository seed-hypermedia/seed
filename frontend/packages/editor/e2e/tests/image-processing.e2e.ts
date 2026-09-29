import {expect, test} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const heicPath = fileURLToPath(new URL('../fixtures/checker.heic', import.meta.url))
const heicBytes = Array.from(readFileSync(heicPath))

test.beforeEach(async ({page}) => {
  await page.goto('/images.html')
  await expect(page.getByLabel('Select image')).toBeVisible()
})

test('real HEIC decoding retains crop detail and runs without a conversion service', async ({page}) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' ||
      (!request.url().startsWith('http://localhost:5180/') && !request.url().startsWith('blob:'))
    ) {
      externalRequests.push(request.url())
    }
  })
  const result = await page.evaluate(async (bytes) => {
    const processing = (window as any).TEST_IMAGE_PROCESSING
    const file = new File([new Uint8Array(bytes)], 'checker.heic', {type: 'application/octet-stream'})
    const prepared = await processing.prepareImageForCrop(file)
    const preview = await createImageBitmap(prepared)
    const output = await processing.processImage(file, processing.AVATAR_IMAGE_POLICY)
    const bitmap = await createImageBitmap(output)
    const result = {
      preview: [preview.width, preview.height],
      output: [bitmap.width, bitmap.height],
      type: output.type,
      previewType: prepared.type,
    }
    preview.close()
    bitmap.close()
    return result
  }, heicBytes)
  expect(result).toEqual({preview: [1600, 1200], output: [1024, 768], type: 'image/webp', previewType: 'image/png'})
  expect(externalRequests).toEqual([])
})

test('native crop source retains resolution and final crop is not re-encoded', async ({page}) => {
  const result = await page.evaluate(async () => {
    const processing = (window as any).TEST_IMAGE_PROCESSING
    const cropping = (window as any).TEST_IMAGE_CROPPING
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 1600
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    const file = new File([blob], 'source.png', {type: blob.type})
    const prepared = await processing.prepareImageForCrop(file)
    const cropped = await cropping.cropImageFile(
      prepared,
      {x: 400, y: 0, width: 1600, height: 1600},
      {maxDimension: 1024},
    )
    const uploaded = await processing.processImage(cropped, processing.AVATAR_IMAGE_POLICY)
    const bitmap = await createImageBitmap(uploaded)
    const result = {
      sameSource: prepared === file,
      sameOutput: uploaded === cropped,
      size: [bitmap.width, bitmap.height],
    }
    bitmap.close()
    return result
  })
  expect(result).toEqual({sameSource: true, sameOutput: true, size: [1024, 1024]})
})

test('HEIC crop dialog supports cancel and confirmation', async ({page}) => {
  await page.getByLabel('Select image').setInputFiles(heicPath)
  await expect(page.getByRole('button', {name: 'Apply'})).toBeEnabled()
  await page.getByRole('button', {name: 'Cancel'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('output')).toHaveText('No image uploaded')
  await page.getByLabel('Select image').setInputFiles([])
  await page.getByLabel('Select image').setInputFiles(heicPath)
  await expect(page.getByRole('button', {name: 'Apply'})).toBeEnabled()
  await page.getByRole('button', {name: 'Apply'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('output')).toHaveText('1024×1024; unchanged=true')
})

test('crop dialog rejects animation without uploading a still frame', async ({page}) => {
  const header = [...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]
  const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]
  await page.getByLabel('Select image').setInputFiles({
    name: 'animated.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from([...header, ...frame, ...frame, 0x3b]),
  })
  await expect(page.getByText('Animated images cannot be cropped; choose a still image')).toBeVisible()
  await expect(page.getByRole('button', {name: 'Apply'})).toBeDisabled()
  await page.getByRole('button', {name: 'Cancel'}).click()
  await expect(page.locator('output')).toHaveText('No image uploaded')
})

for (const action of ['paste', 'drop'] as const) {
  test(`editor ${action} accepts a HEIC with an empty MIME type`, async ({page}) => {
    await page.goto('/?imageUpload=1')
    await page.locator('[contenteditable="true"]').first().click()
    await page.waitForFunction(() => window.TEST_EDITOR?.editor?.ready === true)
    await page.evaluate(
      ({bytes, action}) => {
        const editor = window.TEST_EDITOR.editor!
        editor.focus()
        const view = editor._tiptapEditor.view
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], 'checker.heic'))
        if (action === 'paste') {
          view.dom.dispatchEvent(
            new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true}),
          )
        } else {
          const block = view.dom.querySelector('[data-content-type="paragraph"]')!
          const rect = block.getBoundingClientRect()
          block.dispatchEvent(
            new DragEvent('drop', {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
              clientX: rect.x + 10,
              clientY: rect.y + rect.height / 2,
            }),
          )
        }
      },
      {bytes: heicBytes, action},
    )
    await expect
      .poll(() => page.evaluate(() => window.TEST_EDITOR.getBlocks().filter((block) => block.type === 'image').length))
      .toBe(1)
    const image = await page.evaluate(async () => {
      const block = window.TEST_EDITOR.getBlocks().find((value) => value.type === 'image')!
      const props = block.props as {url: string; name: string}
      const blob = await (await fetch(props.url)).blob()
      const bitmap = await createImageBitmap(blob)
      const result = {name: props.name, type: blob.type, size: [bitmap.width, bitmap.height]}
      bitmap.close()
      return result
    })
    expect(image).toEqual({name: 'checker.webp', type: 'image/webp', size: [1600, 1200]})
  })
}

test('unhandled file drops are canceled without blocking text drops or child targets', async ({page}) => {
  const result = await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['image'], 'image.png', {type: 'image/png'}))
    const fileDrop = new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true})
    document.body.dispatchEvent(fileDrop)
    const text = new DataTransfer()
    text.setData('text/plain', 'text')
    const textDrop = new DragEvent('drop', {dataTransfer: text, bubbles: true, cancelable: true})
    document.body.dispatchEvent(textDrop)
    const target = document.createElement('div')
    document.body.append(target)
    let handled = false
    target.addEventListener('drop', (event) => {
      handled = true
      event.preventDefault()
    })
    target.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}))
    target.remove()
    return {fileCanceled: fileDrop.defaultPrevented, textCanceled: textDrop.defaultPrevented, handled}
  })
  expect(result).toEqual({fileCanceled: true, textCanceled: false, handled: true})
  await expect(page).toHaveURL('http://localhost:5180/images.html')
})
