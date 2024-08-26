// @ts-nocheck
import {
  getFileUrl,
  isHypermediaScheme,
  toHMInlineContent,
  unpackHmId,
  type HMBlock,
  type HMBlockChildrenType,
  type HMBlockNode,
} from "@shm/shared";
import {useMemo} from "react";

export function DocContent({content}: {content: Array<HMBlockNode>}) {
  console.log(
    `\n\n================================= ~ DocContent ~ content:`,
    content
  );
  return <Group type="group" content={content} depth={1} />;
}

export function Group({
  type,
  content,
  depth,
}: {
  type: HMBlockChildrenType;
  content: Array<HMBlockNode>;
  depth: number;
}) {
  let children = content
    ? content.map((bn) => (
        <BlockNode depth={depth} key={bn.block?.id} bn={bn} />
      ))
    : null;
  if (type == "ol") {
    return <ol>{children}</ol>;
  } else if (type == "ul") {
    return <ul>{children}</ul>;
  } else {
    return <>{children}</>;
  }
}

export function BlockNode({bn, depth}: {bn: HMBlockNode; depth: number}) {
  const hasChildren = !!bn.children?.length;

  if (isBlockNodeEmpty(bn)) return null;

  if (hasChildren) {
    return (
      <>
        <Block block={bn.block} depth={depth} />
        {bn.block.type == "heading" ? (
          <>
            <Group
              type={bn.block.attributes?.childrenType}
              depth={depth + 1}
              content={bn.children}
            />
          </>
        ) : (
          <div class="ml-8" id={bn.block.id}>
            <Group
              type={bn.block.attributes?.childrenType}
              depth={depth + 1}
              content={bn.children}
            />
          </div>
        )}
      </>
    );
  }
  return <Block block={bn.block} depth={depth} />;
}

export function Block(props: {block: HMBlock; depth: number}) {
  if (props.block.type == "paragraph") {
    return <ParagraphBlock {...props} />;
  } else if (props.block.type == "heading") {
    return <HeadingBlock {...props} />;
  } else if (props.block.type == "image") {
    return <ImageBlock {...props} />;
  } else if (props.block.type == "video") {
    return <VideoBlock {...props} />;
  } else if (props.block.type == "file") {
    return <FileBlock {...props} />;
  } else if (props.block.type == "embed") {
    return <EmbedBlock {...props} />;
  } else if (props.block.type == "codeBlock") {
    return <CodeBlock {...props} />;
  } else if (["equation", "math"].includes(props.block.type)) {
    return <MathBlock {...props} />;
  } else {
    return <ParagraphBlock {...props} />;
  }
}

type BlockProps = {
  block: HMBlock;
  depth: number;
};

function ParagraphBlock({block}: BlockProps) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  return (
    <p>
      <InlineContent inline={inline} />
    </p>
  );
}

function HeadingBlock({block, depth = 1}: BlockProps) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  const Heading = useMemo(() => `h${depth + 1 > 6 ? 6 : depth + 1}`, [depth]);

  return (
    <Heading>
      <InlineContent inline={inline} />
    </Heading>
  );
}

function ImageBlock({block}: BlockProps) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  return (
    <figure>
      <img
        src={getFileUrl(block?.ref)}
        style={{width: "100%"}}
        alt={block.attributes.alt}
      />
      <figcaption class="caption-bottom">
        <InlineContent inline={inline} />
      </figcaption>
    </figure>
  );
}

function VideoBlock({block}: BlockProps) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  return (
    <div class="prose-video relative pb-9/16">
      {block.ref?.startsWith("ipfs://") ? (
        <video
          controls
          frameborder="0"
          class="w-full h-full rounded-lg shadow-md absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
        >
          <source
            src={getFileUrl(block.ref)}
            type={getSourceType(block.attributes.name)}
          />
          Your browser does not support the video tag.
        </video>
      ) : (
        <iframe
          allowfullscreen
          frameborder="0"
          class="w-full h-full rounded-lg shadow-md absolute top-0 left-0 w-full h-full rounded-lg shadow-md"
          src={block.ref}
        />
      )}
      {inline.length ? (
        <p>
          <InlineContent inline={inline} />
        </p>
      ) : null}
    </div>
  );
}

function FileBlock({block}: BlockProps) {
  return <p>file: {block.attributes.name}</p>;
}

function EmbedBlock({block}: BlockProps) {
  return <p>embed: {block.ref}</p>;
}

function CodeBlock({block}: BlockProps) {
  return (
    <pre class="rounded-md border-[0.5px] border-token-border-medium">
      <div class="overflow-y-auto p-4">
        <code>{block.text}</code>
      </div>
    </pre>
  );
}

function MathBlock({block}: BlockProps) {
  return <p>mathblock: {block.text}</p>;
}

export function InlineContent({
  inline,
  className,
}: {
  className: string;
  inline: Array<EditorInlineContent>;
}) {
  return (
    <span className={className}>
      {inline.map((c) => {
        if (c.type == "text") {
          let children = c.text;

          if (c.styles.bold) {
            children = <b>{children}</b>;
          }
          if (c.styles.italic) {
            children = <i>{children}</i>;
          }
          if (c.styles.underline) {
            children = <u>{children}</u>;
          }

          if (c.styles.code) {
            children = <code>{children}</code>;
          }

          if (c.styles.strikethrough) {
            children = <span className="line-through">{children}</span>;
          }

          return <span>{children}</span>;
        }
        if (c.type == "inline-embed") {
        }
        if (c.type == "link") {
          return (
            <a
              href={getSiteHref({entry: c.href})}
              target={!isHypermediaScheme(c.href) ? "_blank" : undefined}
            >
              <InlineContent inline={c.content} />
            </a>
          );
        }
      })}
    </span>
  );
}

function isBlockNodeEmpty(bn: HMBlockNode): boolean {
  if (bn.children && bn.children.length) return false;
  if (typeof bn.block == "undefined") return true;
  switch (bn.block.type) {
    case "paragraph":
    case "heading":
    case "math":
    case "equation":
    case "code":
    case "codeBlock":
      return !bn.block.text;
    case "image":
    case "file":
    case "video":
    case "nostr":
    case "embed":
    case "web-embed":
      return !bn.block.ref;
    default:
      return false;
  }
}

function getSiteHref({entry}: {entry: string; hostname?: string}) {
  const unpacked = unpackHmId(entry);

  if (!unpacked) return entry;
  return entry;
}

function getSourceType(name?: string) {
  if (!name) return;
  const nameArray = name.split(".");
  return `video/${nameArray[nameArray.length - 1]}`;
}
