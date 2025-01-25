import {
  DAEMON_FILE_URL,
  HMBlock,
  HMBlockChildrenType,
  HMBlockImage,
  HMBlockNode,
  HMDocument,
  HMDocumentMetadataSchema,
  HMDocumentSchema,
  HMMetadata,
  UnpackedHypermediaId,
  clipContentBlocks,
  entityQueryPathToHmIdPath,
  getCIDFromIPFSUrl,
  getDocumentTitle,
  getParentPaths,
  hmId,
  hmIdPathToEntityQueryPath,
} from "@shm/shared";
import {readFileSync} from "fs";
import {join} from "path";
import satori from "satori";
import svg2img from "svg2img";
import {queryClient} from "~/client";

import {toPlainMessage} from "@bufbuild/protobuf";
import {InlineContent} from "@shm/desktop/src/editor";

export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

function loadFont(fileName: string) {
  const path = join(process.cwd(), "font", fileName);
  return readFileSync(path);
}

const AVATAR_SIZE = 100;
const IPFS_RESOURCE_PREFIX = `${process.env.GRPC_HOST}/ipfs/`;

const avatarLayout: React.CSSProperties = {
  margin: 10,
};

function InlineContentView({
  content,
  fontWeight = "normal",
  fontSize = 38,
}: {
  content: InlineContent[];
  fontWeight?: "bold" | "normal";
  fontSize?: number;
}) {
  return (
    <span style={{fontSize, fontWeight}}>
      {content.map((item, index) => {
        if (item.type === "link")
          return (
            <span key={index} style={{color: "#000055", marginLeft: 4}}>
              <InlineContentView content={item.content} />
            </span>
          );
        if (item.type === "text") {
          let content: any = <>{item.text}</>;
          if (item.styles.bold) content = <b>{content}</b>;
          if (item.styles.italic) content = <i>{content}</i>;
          return content;
        }
        return;
      })}
    </span>
  );
}

function ParagraphBlockDisplay({
  block,
  childrenType,
}: {
  block: HMBlock;
  childrenType: HMBlockChildrenType | undefined;
}) {
  return null;
  const inlineContent = toHMInlineContent(block);
  return (
    <div
      style={{
        display: "flex",
        marginTop: 8,
      }}
    >
      <InlineContentView content={inlineContent} fontSize={32} />
    </div>
  );
}

function HeadingBlockDisplay({
  block,
  childrenType,
}: {
  block: HMBlock;
  childrenType: HMBlockChildrenType | undefined;
}) {
  return null;
  const inlineContent = toHMInlineContent(block);
  return (
    <div
      style={{
        display: "flex",
        marginTop: 8,
      }}
    >
      <InlineContentView
        content={inlineContent}
        fontSize={48}
        fontWeight="bold"
      />
    </div>
  );
}
function ImageBlockDisplay({block}: {block: HMBlockImage}) {
  return (
    <img
      style={{borderRadius: 8}}
      src={`${IPFS_RESOURCE_PREFIX}${getCIDFromIPFSUrl(block.link)}`}
    />
  );
}
function BlockDisplay({
  block,
  childrenType,
}: {
  block: HMBlock;
  childrenType: HMBlockChildrenType | undefined;
}) {
  console.log("hello", childrenType, block.type);
  if (block.type === "Paragraph")
    return <ParagraphBlockDisplay block={block} childrenType={childrenType} />;
  if (block.type === "Heading")
    return <HeadingBlockDisplay block={block} childrenType={childrenType} />;

  if (block.type === "Image") return <ImageBlockDisplay block={block} />;

  return null;
}

function BlockNodeDisplay({
  index,
  blockNode,
}: {
  index: number;
  blockNode: HMBlockNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {blockNode.block && (
        <BlockDisplay
          block={blockNode.block}
          childrenType={blockNode.block.attributes?.childrenType}
        />
      )}
      <div style={{display: "flex", marginLeft: 20, flexDirection: "column"}}>
        {blockNode.children?.map((child, index) => {
          if (!child.block) return null;
          return (
            <BlockNodeDisplay
              index={index}
              key={child.block.id}
              blockNode={child}
            />
          );
        })}
      </div>
    </div>
  );
}

const BG_COLOR = "#f5f5f5";

function TitleMembersCard({
  title,
  authors,
  children,
}: {
  title: string;
  authors: HMDocument[];
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        color: "black",
        display: "flex",
        height: "100%",
        width: "100%",
        backgroundColor: BG_COLOR,
      }}
    >
      <div style={{padding: 60, display: "flex", flexDirection: "column"}}>
        {title && (
          <div style={{display: "flex", marginBottom: 20}}>
            <span style={{fontSize: 72, fontWeight: "bold"}}>{title}</span>
          </div>
        )}
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          left: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: `linear-gradient(#ffffff11, #ffffff11, ${BG_COLOR})`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: 40,
          }}
        >
          {authors.map((author) => {
            const accountLetter = "?";
            if (!author.metadata.icon)
              return (
                <div
                  style={{
                    backgroundColor: "#aac2bd", // mintty, yum!
                    display: "flex",
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: AVATAR_SIZE / 2,
                    justifyContent: "center",
                    alignItems: "center",
                    ...avatarLayout,
                  }}
                >
                  <span style={{fontSize: 50, position: "relative", bottom: 6}}>
                    {accountLetter}
                  </span>
                </div>
              );
            const src = `${DAEMON_FILE_URL}/${getCIDFromIPFSUrl(
              author.metadata.icon
            )}`;
            return (
              /* eslint-disable */
              <img
                key={author.account}
                src={src}
                width={AVATAR_SIZE}
                height={AVATAR_SIZE}
                style={{
                  backgroundColor: "black",
                  borderRadius: AVATAR_SIZE / 2,
                  ...avatarLayout,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DocumentCard({
  document,
  authors,
  breadcrumbs,
}: {
  document: HMDocument;
  authors: HMDocument[];
  breadcrumbs: {
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
  }[];
}) {
  const clippedContent = clipContentBlocks(
    document.content,
    8 // render a maximum of 8 blocks in the OG image
  );
  const title = getDocumentTitle(document);
  return (
    <TitleMembersCard title={title || "Untitled Document"} authors={authors}>
      {null}
      {/* {clippedContent?.map((child, index) => {
        return (
          <BlockNodeDisplay
            key={child.block.id}
            blockNode={child}
            index={index}
          />
        );
      })} */}
    </TitleMembersCard>
  );
}

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url);
  const space = url.searchParams.get("space");
  const path = url.searchParams.get("path");
  const version = url.searchParams.get("version");
  if (!space) throw new Error("Missing space");
  // if (path) throw new Error("Missing path");
  if (!version) throw new Error("Missing version");
  let content: null | JSX.Element = null;
  const rawDoc = await queryClient.documents.getDocument({
    account: space,
    version,
    path: path || "",
  });
  const crumbs = getParentPaths(entityQueryPathToHmIdPath(path || "")).slice(
    0,
    -1
  );
  const breadcrumbs = await Promise.all(
    crumbs.map(async (crumbPath) => {
      const document = await queryClient.documents.getDocument({
        account: space,
        path: hmIdPathToEntityQueryPath(crumbPath),
      });
      return {
        id: hmId("d", space, {path: crumbPath}),
        metadata: document.metadata?.toJson(),
      };
    })
  );

  const document = HMDocumentSchema.parse(toPlainMessage(rawDoc));
  if (!document) throw new Error("Document not found");
  const authors = await Promise.all(
    (document?.authors || []).map(async (authorUid) => {
      const rawDoc = await queryClient.documents.getDocument({
        account: authorUid,
      });
      const document = HMDocumentSchema.parse({
        ...toPlainMessage(rawDoc),
        metadata: HMDocumentMetadataSchema.parse(
          rawDoc.metadata?.toJson({emitDefaultValues: true})
        ),
      });

      return document;
    })
  );
  content = (
    <DocumentCard
      document={document}
      authors={authors}
      breadcrumbs={breadcrumbs}
    />
  );

  const svg = await satori(content, {
    width: OG_IMAGE_SIZE.width,
    height: OG_IMAGE_SIZE.height,
    fonts: [
      {
        name: "Georgia",
        data: loadFont("Georgia.ttf"),
        weight: 400,
        style: "normal",
      },
      {
        name: "Georgia",
        data: loadFont("Georgia Bold.ttf"),
        weight: 700,
        style: "normal",
      },
      {
        name: "Georgia",
        data: loadFont("Georgia Italic.ttf"),
        weight: 400,
        style: "italic",
      },
      {
        name: "Georgia",
        data: loadFont("Georgia Bold Italic.ttf"),
        weight: 700,
        style: "italic",
      },
    ],
  });
  const png = await new Promise<Buffer>((resolve, reject) =>
    svg2img(svg, function (error, buffer) {
      if (error) reject(error);
      else resolve(buffer);
    })
  );
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": png.length.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  // setAllowAnyHostGetCORS(res)
  // res.status(200).setHeader('Content-Type', 'image/png').send(png)
};
