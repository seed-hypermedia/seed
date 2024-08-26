// @ts-nocheck
import type {EditorInlineContent} from "@shm/desktop/src/editor";
import {
  isHypermediaScheme,
  toHMInlineContent,
  unpackHmId,
  type HMBlock,
  type HMBlockChildrenType,
  type HMBlockNode,
} from "@shm/shared";
import {Fragment, useMemo} from "react";

export function DocContent({content}: {content: Array<HMBlockNode>}) {
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
  const bnChildren = hasChildren
    ? bn.children.map((bn, index) => <BlockNode bn={bn} depth={depth + 1} />)
    : null;

  if (isBlockNodeEmpty(bn)) return null;

  const Wrapper = hasChildren ? "div" : Fragment;

  return (
    <Wrapper id={bn.block.id}>
      <Block block={bn.block} depth={depth} />
      {hasChildren ? (
        <Group type={bn.block.attributes?.childrenType} depth={depth + 1} />
      ) : null}
    </Wrapper>
  );
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
              href={getSiteHref(c.href)}
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

function HeadingBlock({block, depth}: BlockProps) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  const Heading = useMemo(() => `h${depth + 1}`, [depth]);
  console.log("== HEADING", block, depth);
  return (
    <Heading>
      <InlineContent inline={inline} />
    </Heading>
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

function getSiteHref({}: {entry: string; hostname?: string}) {
  const unpacked = unpackHmId(entry);

  if (!unpacked) return entry;
  return entry;
}
