import {grpcClient} from '@/client.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {
  HMDocument,
  HMDocumentMetadataSchema,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  entityQueryPathToHmIdPath,
  getDocumentImage,
  getDocumentTitle,
  getParentPaths,
  hmId,
  hmIdPathToEntityQueryPath,
  hostnameStripProtocol,
} from '@shm/shared'
import {SeedLogo} from '@shm/ui/seed-logo'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {readFileSync} from 'fs'
import {join} from 'path'
import satori from 'satori'
import sharp from 'sharp'
import {processImage} from '../utils/image-processor'

/** Pixel dimensions for social link previews. */
export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
}

function loadFont(fileName: string) {
  return readFileSync(join(process.cwd(), 'font', fileName))
}

const colors = {
  background: '#ffffff',
  ink: '#202723',
  muted: '#707973',
  border: '#e3e8e4',
  green: 'hsl(166, 55%, 31%)',
  pale: '#edf4ef',
}

function DocumentCard({
  document,
  authors,
  breadcrumbs,
  icon,
  cover,
}: {
  document: HMDocument
  authors: {document: HMDocument; icon: string | null; id: UnpackedHypermediaId}[]
  breadcrumbs: HMMetadataPayload[]
  icon: string | null
  cover: string | null
}) {
  const title = getDocumentTitle(document) || 'Untitled document'
  const parentNames = [...breadcrumbs]
    .reverse()
    .map((b) => b.metadata?.name)
    .filter(Boolean)
  const context = (parentNames.length > 4 ? [parentNames[0], '…', ...parentNames.slice(-2)] : parentNames).join(' / ')
  const domain = document.metadata.siteUrl ? hostnameStripProtocol(document.metadata.siteUrl) : ''
  const titleSize = cover ? (title.length > 70 ? 52 : 64) : title.length > 100 ? 60 : title.length > 70 ? 64 : 76
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: colors.background,
        color: colors.ink,
        fontFamily: 'Inter',
        padding: '60px 64px 44px',
        borderBottom: `12px solid ${colors.green}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          height: 32,
          flexShrink: 0,
          color: colors.muted,
          fontSize: 22,
        }}
      >
        <div style={{width: 28, height: 4, background: colors.green, borderRadius: 2, flexShrink: 0}} />
        <div style={{display: 'block', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
          {context || domain || 'Document'}
        </div>
      </div>
      <div style={{display: 'flex', gap: 48, flex: 1, alignItems: 'flex-start', paddingTop: 32}}>
        <div style={{display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0}}>
          <div
            style={{
              display: 'block',
              fontSize: titleSize,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -2.5,
              maxHeight: 320,
              overflow: 'hidden',
              lineClamp: titleSize > 70 ? 3 : 4,
              wordBreak: 'break-word',
            }}
          >
            {title}
          </div>
        </div>
        {cover ? (
          <div style={{display: 'flex', width: 352, height: 320, position: 'relative', flexShrink: 0}}>
            <img alt="" src={cover} width={352} height={320} style={{objectFit: 'cover', borderRadius: 20}} />
            {icon && (
              <div
                style={{
                  display: 'flex',
                  position: 'absolute',
                  left: 16,
                  bottom: 16,
                  padding: 5,
                  background: colors.background,
                  borderRadius: 18,
                }}
              >
                <img alt="" src={icon} width={64} height={64} style={{borderRadius: 13}} />
              </div>
            )}
          </div>
        ) : icon ? (
          <img
            alt=""
            src={icon}
            width={176}
            height={176}
            style={{borderRadius: 28, objectFit: 'cover', flexShrink: 0}}
          />
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          height: 88,
          flexShrink: 0,
          borderTop: `1px solid ${colors.border}`,
          paddingTop: 28,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 32,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 16, width: 800, flexShrink: 0}}>
          {authors.length > 0 ? (
            <>
              <div style={{display: 'flex', gap: 6, width: Math.min(authors.length, 3) * 50 - 6, flexShrink: 0}}>
                {authors.slice(0, 3).map((author) =>
                  author.icon ? (
                    <img
                      alt=""
                      key={author.id.id}
                      src={author.icon}
                      width={44}
                      height={44}
                      style={{borderRadius: 22}}
                    />
                  ) : (
                    <div
                      key={author.id.id}
                      style={{
                        display: 'flex',
                        width: 44,
                        height: 44,
                        flexShrink: 0,
                        borderRadius: 22,
                        background: colors.pale,
                        color: colors.green,
                        fontSize: 20,
                        fontWeight: 700,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {author.document.metadata.name?.slice(0, 1) || '?'}
                    </div>
                  ),
                )}
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 5, width: 600, paddingLeft: 16}}>
                <div
                  style={{
                    display: 'block',
                    fontSize: 19,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}
                >
                  {authors
                    .slice(0, 2)
                    .map((a) => a.document.metadata.name || 'Anonymous')
                    .join(' & ') + (authors.length > 2 ? ` +${authors.length - 2}` : '')}
                </div>
                <span style={{fontSize: 16, color: colors.muted, whiteSpace: 'nowrap'}}>
                  {authors.length === 1 ? 'Author' : `${authors.length} authors`}
                </span>
              </div>
            </>
          ) : (
            <span
              style={{
                display: 'block',
                width: 800,
                fontSize: 22,
                color: colors.muted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {domain || context || 'Published on Seed'}
            </span>
          )}
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 10, color: colors.green, flexShrink: 0}}>
          <SeedLogo width={19} height={26} />
          <span style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.5}}>Seed Hypermedia</span>
        </div>
      </div>
    </div>
  )
}

/** Generate a PNG preview for a document using the request’s daemon credentials. */
export const loader = async ({request}: {request: Request}) => {
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, () => loadContentImage(request))
}

async function loadContentImage(request: Request) {
  const url = new URL(request.url)
  const space = url.searchParams.get('space')
  const path = url.searchParams.get('path')
  const version = url.searchParams.get('version')
  if (!space) throw new Error('Missing space')
  if (!version) throw new Error('Missing version')
  const rawDoc = await grpcClient.documents.getDocument({
    account: space,
    version,
    path: path || '',
  })
  const crumbs = getParentPaths(entityQueryPathToHmIdPath(path || ''))
    .slice(0, -1)
    .reverse()
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const document = await grpcClient.documents.getDocument({
        account: space,
        path: hmIdPathToEntityQueryPath(crumbPath),
      })
      return {
        id: hmId(space, {path: crumbPath}),
        metadata: HMDocumentMetadataSchema.parse(
          document.metadata?.toJson({
            emitDefaultValues: true,
            enumAsInteger: false,
          }) || {},
        ),
      }
    }),
  )

  const document = prepareHMDocument(rawDoc)
  if (!document) throw new Error('Document not found')
  const authors = await Promise.all(
    (document?.authors || []).map(async (authorUid) => {
      try {
        const rawDoc = await grpcClient.documents.getDocument({
          account: authorUid,
        })
        return prepareHMDocument(rawDoc)
      } catch (error) {
        // An unavailable author profile must not prevent sharing the document.
        console.error(`Failed to load profile for author ${authorUid}:`, error)
        return null
      }
    }),
  )
  const processedAuthors = await Promise.all(
    authors
      .filter((author) => author !== null)
      .map(async (author) => {
        const id = hmId(author.account)
        if (author.metadata.icon) {
          try {
            const processedImage = await processImage(author.metadata.icon)
            return {
              document: author,
              icon: processedImage,
              id,
            }
          } catch (error) {
            console.error(`Failed to process image for author ${author.account}:`, error)
            return {document: author, icon: null, id}
          }
        }
        return {document: author, icon: null, id}
      }),
  )

  let iconValue: string | null = null
  if (document.metadata.icon) {
    iconValue = await processImage(document.metadata.icon)
  } else if (breadcrumbs.length > 0) {
    const breadcrumb = breadcrumbs.at(0)
    if (breadcrumb?.metadata?.icon) {
      iconValue = await processImage(breadcrumb.metadata.icon)
    }
  }

  let cover = null
  const docImage = getDocumentImage(document)
  if (docImage) {
    cover = await processImage(docImage)
  } else if (breadcrumbs.length > 0) {
    const breadcrumb = breadcrumbs.at(0)
    if (breadcrumb?.metadata?.cover) {
      cover = await processImage(breadcrumb.metadata.cover)
    }
  }

  const content = (
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
      {name: 'Inter', data: loadFont('Inter_28pt-Medium.ttf'), weight: 400, style: 'normal'},
      {name: 'Inter', data: loadFont('Inter_28pt-Bold.ttf'), weight: 700, style: 'normal'},
    ],
  })
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': png.length.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
