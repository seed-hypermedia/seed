// @ts-nocheck
import type {EditorInlineContent} from "@shm/desktop/src/editor";
import {
  toHMInlineContent,
  type HMBlock,
  type HMBlockChildrenType,
  type HMBlockNode,
} from "@shm/shared";
import {useMemo} from "react";

export function DocContent({content}: {content: Array<HMBlockNode>}) {
  return <Group type="group" content={content} />;
}

export function Group({
  type,
  content,
}: {
  type: HMBlockChildrenType;
  content: Array<HMBlockNode>;
}) {
  let children = content.map((bn) => <BlockNode key={bn.block?.id} bn={bn} />);
  if (type == "ol") {
    return <ol>{children}</ol>;
  } else if (type == "ul") {
    return <ul>{children}</ul>;
  } else {
    return <>{children}</>;
  }
}

export function BlockNode({bn}: {bn: HMBlockNode}) {
  return (
    <>
      <Block block={bn.block} />
      {/* TODO children */}
    </>
  );
}

export function Block({block}: {block: HMBlock}) {
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock block={block} />;
    default:
      return <p>{block.text}</p>;
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
            children = <span className="FOO line-through">{children}</span>;
          }

          return <span>{children}</span>;
        }
        if (c.type == "inline-embed") {
        }
        if (c.type == "link") {
          return (
            <a href={c.href}>
              <InlineContent className="foo" inline={c.content} />
            </a>
          );
        }
      })}
    </span>
  );
}

function ParagraphBlock({block}: {block: HMBlock}) {
  const inline = useMemo(() => toHMInlineContent(block), [block]);
  return (
    <p>
      <InlineContent inline={inline} />
    </p>
  );
}
