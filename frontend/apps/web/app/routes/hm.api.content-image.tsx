import {queryClient} from '@/client'
import {
  HMDocument,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  HMMetadataPayload,
  UnpackedHypermediaId,
  clipContentBlocks,
  entityQueryPathToHmIdPath,
  getDocumentTitle,
  getParentPaths,
  hmId,
  hmIdPathToEntityQueryPath,
  hostnameStripProtocol,
} from '@shm/shared'
import {readFileSync} from 'fs'
import {join} from 'path'
import satori from 'satori'
import svg2img from 'svg2img'
import {processImage} from '../utils/image-processor'

import {toPlainMessage} from '@bufbuild/protobuf'

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
}

const PERCENTAGE_COVER_WIDTH = 59 // from the designs
const COVER_WIDTH = Math.round(
  OG_IMAGE_SIZE.width * (PERCENTAGE_COVER_WIDTH / 100),
)
function loadFont(fileName: string) {
  const path = join(process.cwd(), 'font', fileName)
  return readFileSync(path)
}

const AVATAR_SIZE = 100

const MAIN_ICON_SIZE = 200

const IPFS_RESOURCE_PREFIX = `${process.env.GRPC_HOST}/ipfs/`

const avatarLayout: React.CSSProperties = {
  margin: 10,
}

const BG_COLOR = '#f5f5f5'

function DocumentCard({
  document,
  authors,
  breadcrumbs,
  icon,
  cover,
}: {
  document: HMDocument
  authors: {
    document: HMDocument
    icon: string | null
    id: UnpackedHypermediaId
  }[]
  breadcrumbs: HMMetadataPayload[]
  icon: string | null
  cover: string | null
}) {
  const clippedContent = clipContentBlocks(
    document.content,
    8, // render a maximum of 8 blocks in the OG image
  )
  const title = getDocumentTitle(document)

  return (
    <div
      style={{
        color: 'black',
        display: 'flex',
        height: '100%',
        width: '100%',
        backgroundColor: BG_COLOR,
      }}
    >
      <div
        style={{
          padding: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: cover ? OG_IMAGE_SIZE.width - COVER_WIDTH : '100%',
          gap: 16,
        }}
      >
        {icon && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <img
              src={icon}
              width={MAIN_ICON_SIZE}
              height={MAIN_ICON_SIZE}
              style={{borderRadius: MAIN_ICON_SIZE / 2}}
            />
          </div>
        )}
        {title && (
          <div
            style={{
              display: 'flex',
              marginBottom: 20,
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                textAlign: 'center',
                fontFamily: 'Inter',
              }}
            >
              {title || 'Untitled Document'}
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {breadcrumbs.map((breadcrumb, index) => (
            <span
              key={breadcrumb.id.id}
              style={{
                fontSize: 20,
                fontWeight: 'bold',
                textAlign: 'center',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Inter',
                color: index === breadcrumbs.length - 1 ? '$111111' : '#333333',
              }}
            >
              {breadcrumb.metadata?.name || '?'}
            </span>
          ))}
        </div>
        {document.metadata.siteUrl && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 22,
              fontWeight: 'bold',
              color: '#333333',
              fontFamily: 'Inter',
            }}
          >
            {hostnameStripProtocol(document.metadata.siteUrl)}
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          left: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: 40,
          }}
        >
          {authors.map((author) => {
            const accountLetter =
              author.document.metadata?.name?.slice(0, 1) || '?'
            if (!author.document.metadata.icon || !author.icon)
              return (
                <div
                  style={{
                    backgroundColor: '#aac2bd',
                    display: 'flex',
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: AVATAR_SIZE / 2,
                    justifyContent: 'center',
                    alignItems: 'center',
                    ...avatarLayout,
                  }}
                >
                  <span
                    style={{
                      fontSize: 50,
                      position: 'relative',
                      bottom: 6,
                      fontWeight: 'bold',
                      fontFamily: 'Inter',
                    }}
                  >
                    {accountLetter}
                  </span>
                </div>
              )
            return (
              <img
                key={author.id.id}
                src={author.icon}
                width={AVATAR_SIZE}
                height={AVATAR_SIZE}
                style={{
                  fontSize: 1,
                  backgroundColor: 'black',
                  borderRadius: AVATAR_SIZE / 2,
                  objectFit: 'cover',
                }}
              />
            )
          })}
        </div>
      </div>
      {cover && (
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            right: 0,
            width: COVER_WIDTH,
            bottom: 0,
            backgroundColor: 'red',
          }}
        >
          <img
            src={cover}
            width={COVER_WIDTH}
            height={OG_IMAGE_SIZE.height}
            style={{
              objectFit: 'cover',
            }}
          />
        </div>
      )}
    </div>
  )
}

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url)
  const space = url.searchParams.get('space')
  const path = url.searchParams.get('path')
  const version = url.searchParams.get('version')
  if (!space) throw new Error('Missing space')
  // if (path) throw new Error("Missing path");
  if (!version) throw new Error('Missing version')
  let content: null | JSX.Element = null
  const docId = hmId('d', space, {path: entityQueryPathToHmIdPath(path || '')})
  const rawDoc = await queryClient.documents.getDocument({
    account: space,
    version,
    path: path || '',
  })
  const crumbs = getParentPaths(entityQueryPathToHmIdPath(path || ''))
    .slice(0, -1)
    .reverse()
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const document = await queryClient.documents.getDocument({
        account: space,
        path: hmIdPathToEntityQueryPath(crumbPath),
      })
      return {
        id: hmId('d', space, {path: crumbPath}),
        metadata: HMDocumentMetadataSchema.parse(
          document.metadata?.toJson({emitDefaultValues: true}) || {},
        ),
      }
    }),
  )

  const document = HMDocumentSchema.parse(rawDoc.toJson())
  if (!document) throw new Error('Document not found')
  const authors = await Promise.all(
    (document?.authors || []).map(async (authorUid) => {
      const rawDoc = await queryClient.documents.getDocument({
        account: authorUid,
      })
      const document = HMDocumentSchema.parse({
        ...toPlainMessage(rawDoc),
        metadata: HMDocumentMetadataSchema.parse(
          rawDoc.metadata?.toJson({emitDefaultValues: true}),
        ),
      })

      return document
    }),
  )

  let processedAuthors = await Promise.all(
    authors.map(async (author) => {
      const id = hmId('d', author.account)
      if (author.metadata.icon) {
        try {
          const processedImage = await processImage(author.metadata.icon)
          return {
            document: author,
            icon: processedImage,
            id,
          }
        } catch (error) {
          console.error(
            `Failed to process image for author ${author.account}:`,
            error,
          )
          return {document: author, icon: null, id}
        }
      }
      return {document: author, icon: null, id}
    }),
  )

  let iconId: string | null = null
  let iconValue: string | null = null
  if (document.metadata.icon) {
    iconId = docId.id
    iconValue = await processImage(document.metadata.icon)
  } else if (breadcrumbs.length > 0) {
    const breadcrumb = breadcrumbs.at(0)
    if (breadcrumb?.metadata?.icon) {
      iconId = breadcrumb.id.id
      iconValue = await processImage(breadcrumb.metadata.icon)
    }
  }

  if (iconId) {
    // remove the author from the face pile if the id matches
    processedAuthors = processedAuthors.filter(
      (author) => author.id.id !== iconId,
    )
  }

  let cover = null
  if (document.metadata.cover) {
    cover = await processImage(document.metadata.cover)
  } else if (breadcrumbs.length > 0) {
    const breadcrumb = breadcrumbs.at(0)
    if (breadcrumb?.metadata?.cover) {
      cover = await processImage(breadcrumb.metadata.cover)
    }
  }

  content = (
    <DocumentCard
      document={document}
      icon={iconValue}
      authors={processedAuthors}
      breadcrumbs={breadcrumbs}
      cover={cover}
    />
  )

  const svg = await satori(content, {
    width: OG_IMAGE_SIZE.width,
    height: OG_IMAGE_SIZE.height,
    fonts: [
      {
        name: 'Georgia',
        data: loadFont('Georgia.ttf'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Georgia',
        data: loadFont('Georgia Bold.ttf'),
        weight: 700,
        style: 'normal',
      },
      {
        name: 'Georgia',
        data: loadFont('Georgia Italic.ttf'),
        weight: 400,
        style: 'italic',
      },
      {
        name: 'Georgia',
        data: loadFont('Georgia Bold Italic.ttf'),
        weight: 700,
        style: 'italic',
      },
      {
        name: 'Inter',
        data: loadFont('Inter_28pt-Medium.ttf'),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: loadFont('Inter_28pt-MediumItalic.ttf'),
        weight: 400,
        style: 'italic',
      },
      {
        name: 'Inter',
        data: loadFont('Inter_28pt-Bold.ttf'),
        weight: 700,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: loadFont('Inter_28pt-BoldItalic.ttf'),
        weight: 700,
        style: 'italic',
      },
    ],
  })
  const png = await new Promise<Buffer>((resolve, reject) =>
    svg2img(svg, function (error, buffer) {
      if (error) reject(error)
      else resolve(buffer)
    }),
  )
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': png.length.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
