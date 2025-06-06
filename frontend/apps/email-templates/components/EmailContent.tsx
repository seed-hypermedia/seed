import {
  MjmlColumn,
  MjmlImage,
  MjmlRaw,
  MjmlSection,
  MjmlText,
} from "@faire/mjml-react";
import {HMBlockNode} from "@shm/shared";
import {format} from "date-fns";
import React from "react";
import {Notification} from "../notifier";
import {extractIpfsUrlCid, getDaemonFileUrl} from "./EmailHeader";

//  {
//   title: string; // e.g. "You have a new reply!"
//   senderAvatar?: string;
//   senderName: string;
//   createdAt: string; // formatted date
//   blocks: HMBlockNode[]; // content
//   url: string; // for reply button
// }

export function EmailContent({notification}: {notification: Notification}) {
  const authorName =
    notification.commentAuthorMeta?.name || notification.comment.author;

  const authorAvatar = notification.commentAuthorMeta?.icon
    ? getDaemonFileUrl(notification.commentAuthorMeta?.icon)
    : "";

  const fallbackLetter = authorName[0].toUpperCase();

  const createdAt = notification.comment.createTime?.seconds
    ? format(
        new Date(Number(notification.comment.createTime.seconds) * 1000),
        "MMM d"
      )
    : "";

  return (
    <>
      <MjmlSection backgroundColor="#f9f9f9" borderRadius="6px" padding="16px">
        <MjmlColumn width="20%" verticalAlign="top">
          {/* <MjmlImage
          src={authorAvatar}
          alt="Sender Avatar"
          width="32px"
          height="32px"
          borderRadius="50%"
        /> */}
          {authorAvatar.length ? (
            <MjmlImage
              src={authorAvatar}
              alt="Sender Avatar"
              width="32px"
              height="32px"
              borderRadius="50%"
            />
          ) : (
            <MjmlRaw>
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  backgroundColor: "#ccc",
                  textAlign: "center",
                  lineHeight: "24px",
                  fontWeight: "bold",
                  fontSize: "14px",
                  color: "#ffffff",
                  fontFamily: "sans-serif",
                }}
              >
                {fallbackLetter}
              </div>
            </MjmlRaw>
          )}
        </MjmlColumn>
        <MjmlColumn width="80%" verticalAlign="middle">
          <MjmlText fontSize="12px" fontWeight="bold" paddingBottom="4px">
            {authorName}{" "}
            <span
              style={{color: "#888", fontWeight: "normal", fontSize: "12px"}}
            >
              {createdAt}
            </span>
          </MjmlText>
        </MjmlColumn>
        <MjmlColumn width="100%" verticalAlign="middle">
          {renderBlocks(notification.comment.content)}
        </MjmlColumn>
      </MjmlSection>
    </>
  );
}

function renderBlocks(blocks: HMBlockNode[]) {
  return blocks.map((blockNode, index) => (
    <React.Fragment key={index}>
      {renderBlock(blockNode)}
      {blockNode.children?.length ? renderBlocks(blockNode.children) : null}
    </React.Fragment>
  ));
}

function renderBlock(blockNode: HMBlockNode) {
  const {type, text, annotations, link, attributes} = blockNode.block;

  const innerHtml = renderInlineTextWithAnnotations(text, annotations);

  if (type === "Paragraph") {
    return (
      <MjmlText align="left" paddingBottom="8px" fontSize="14px">
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    );
  }

  if (type === "Heading") {
    return (
      <MjmlText
        align="left"
        paddingBottom="8px"
        fontSize="24px"
        fontWeight="bold"
      >
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    );
  }

  if (type === "Image") {
    const width = attributes?.fields?.width?.kind?.value ?? 400;
    let src: string | undefined = undefined;
    if (link?.startsWith("ipfs://")) {
      const cid = extractIpfsUrlCid(link);
      src = `http://localhost:58001/ipfs/${cid}`;
    } else {
      src = link;
    }

    return (
      <>
        <MjmlImage
          src={src}
          alt={text || "Image"}
          width={width}
          paddingBottom="8px"
        />
        {text && (
          <MjmlText
            fontSize="12px"
            color="#666"
            paddingBottom="12px"
            align="center"
          >
            {text}
          </MjmlText>
        )}
      </>
    );
  }

  return null;
}

function renderInlineTextWithAnnotations(text: string, annotations: any[]) {
  if (!annotations.length) return text;

  let result = [];
  let lastIndex = 0;

  annotations.forEach((annotation, index) => {
    const start = annotation.starts[0];
    const end = annotation.ends[0];

    if (start > lastIndex) {
      result.push(text.slice(lastIndex, start));
    }

    let annotatedText = text.slice(start, end);
    if (annotation.type === "Bold") {
      annotatedText = `<b>${annotatedText}</b>`;
    } else if (annotation.type === "Italic") {
      annotatedText = `<i>${annotatedText}</i>`;
    } else if (annotation.type === "Strikethrough") {
      annotatedText = `<s>${annotatedText}</s>`;
    } else if (annotation.type === "Link") {
      annotatedText = `<a href="${annotation.link}" style="color: #346DB7;">${annotatedText}</a>`;
    }

    result.push(annotatedText);
    lastIndex = end;
  });

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.join("");
}
