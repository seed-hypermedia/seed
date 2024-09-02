import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {
  getDocumentTitle,
  getFileUrl,
  getNodesOutline,
  HMComment,
  HMDocument,
  NodeOutline,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {DirectoryItem} from "@shm/ui/src/directory";
import {CommentGroup} from "@shm/ui/src/discussion";
import {
  BlocksContent,
  DocContent,
  DocContentProvider,
} from "@shm/ui/src/document-content";
import {RadioButtons} from "@shm/ui/src/radio-buttons";
import {Spinner} from "@shm/ui/src/spinner";
import {Button, ButtonText} from "@tamagui/button";
import {Text} from "@tamagui/core";
import {X} from "@tamagui/lucide-icons";
import {ScrollView} from "@tamagui/scroll-view";
import {XStack, YStack} from "@tamagui/stacks";
import {PropsWithChildren, useEffect, useMemo, useState} from "react";
import type {SiteDocumentPayload} from "./loaders";
import {PageHeader} from "./page-header";
import type {DirectoryPayload} from "./routes/hm.api.directory";
import {DiscussionPayload} from "./routes/hm.api.discussion";
import {EmbedDocument} from "./web-embeds";
import {unwrap, Wrapped} from "./wrapping";

export const documentPageMeta: MetaFunction = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload>;
}) => {
  const siteDocument = unwrap<SiteDocumentPayload>(data);
  if (!siteDocument) return [];
  const homeThumbnail = siteDocument.homeMetadata?.thumbnail
    ? getFileUrl(siteDocument.homeMetadata.thumbnail)
    : null;
  const meta: ReturnType<MetaFunction> = [
    {title: getDocumentTitle(siteDocument.document)},
  ];
  if (homeThumbnail) {
    meta.push({
      tagName: "link",
      rel: "icon",
      href: homeThumbnail,
      type: "image/png",
    });
  }
  meta.push({
    name: "hypermedia_id",
    content: siteDocument.id.id,
  });
  meta.push({
    name: "hypermedia_version",
    content: siteDocument.document.version,
  });
  meta.push({
    name: "hypermedia_title",
    content: getDocumentTitle(siteDocument.document),
  });
  return meta;
};

const outlineWidth = 172;
export function DocumentPage({
  document,
  homeId,
  homeMetadata,
  id,
  authors,
}: SiteDocumentPayload) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <YStack>
        <PageHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docMetadata={document.metadata}
          docId={id}
          authors={authors}
          updateTime={document.updateTime}
          openSheet={() => {
            setOpen(!open);
          }}
        />
        <YStack position="relative">
          <Container clearVerticalSpace>
            <YStack
              position="absolute"
              h="100%"
              top={0}
              left={outlineWidth * -1}
              display="none"
              $gtMd={{display: "flex"}}
            >
              <YStack
                width={outlineWidth}
                position="sticky"
                paddingTop={34}
                top={50}
                h="calc(100%)"
                maxHeight="calc(100vh - 60px)"
                overflow="hidden"
                display="none"
                $gtSm={{display: "block"}}
              >
                <YStack
                  gap="$3"
                  maxHeight="100%"
                  overflow="auto"
                  className="hide-scrollbar"
                >
                  <DocumentOutline document={document} />
                </YStack>
              </YStack>
            </YStack>
            <WebDocContentProvider>
              <DocContent document={document} />
            </WebDocContentProvider>
          </Container>
          <DocumentAppendix id={id} />
        </YStack>
      </YStack>
      <MobileOutline open={open} onClose={() => setOpen(false)}>
        <DocumentOutline document={document} onClose={() => setOpen(false)} />
      </MobileOutline>
    </>
  );
}

function WebDocContentProvider({children}: PropsWithChildren<{}>) {
  return (
    <DocContentProvider
      entityComponents={{
        Document: EmbedDocument,
        Comment: () => null,
        Inline: () => null,
      }}
      ipfsBlobPrefix="http://localhost:55001/ipfs/" // todo, configure this properly
      onLinkClick={(href, e) => {}}
      onCopyBlock={(blockId, blockRange) => {}}
      saveCidAsFile={async (cid, name) => {}}
      textUnit={18}
      layoutUnit={24}
      debug={false}
    >
      {children}
    </DocContentProvider>
  );
}

function DocumentAppendix({id}: {id: UnpackedHypermediaId}) {
  const [activeTab, setActiveTab] = useState<"directory" | "discussion">(
    "directory"
  );
  let content = null;
  if (activeTab === "directory") {
    content = <DocumentDirectory id={id} />;
  } else if (activeTab === "discussion") {
    content = <DocumentDiscussion id={id} />;
  }
  return (
    <Container>
      <RadioButtons
        value={activeTab}
        options={
          [
            {key: "discussion", label: "Discussion"},
            {key: "directory", label: "Directory"},
          ] as const
        }
        onValue={setActiveTab}
      />
      {content}
    </Container>
  );
}

function useAPI<ResponsePayloadType>(url?: string) {
  const fetcher = useFetcher();
  useEffect(() => {
    if (!url) return;
    fetcher.load(url);
  }, [url]);
  if (!url) return undefined;
  const response = fetcher.data
    ? unwrap<ResponsePayloadType>(fetcher.data)
    : undefined;
  return response;
}

function DocumentDirectory({id}: {id: UnpackedHypermediaId}) {
  const response = useAPI<DirectoryPayload>(`/hm/api/directory?id=${id.id}`);
  if (response?.error) return <ErrorComponent error={response?.error} />;
  if (!response) return <Spinner />;
  const {directory, authorsMetadata} = response;
  if (!authorsMetadata) return null;
  return (
    <YStack paddingVertical="$4">
      {directory?.map((doc) => (
        <DirectoryItem
          entry={doc}
          authorsMetadata={authorsMetadata}
          PathButton={PathButton}
        />
      ))}
    </YStack>
  );
}

function PathButton() {
  return null;
}

function ErrorComponent({error}: {error: string}) {
  return (
    <YStack backgroundColor="$red2" padding="$4">
      <Text color="$red10">{error}</Text>
    </YStack>
  );
}

function useDiscussion(docId: UnpackedHypermediaId, targetCommentId?: string) {
  let url = `/hm/api/discussion?id=${docId.id}`;
  if (targetCommentId) {
    url += `&targetCommentId=${targetCommentId}`;
  }
  const response = useAPI<DiscussionPayload>(url);
  return response;
}

function DocumentDiscussion({id}: {id: UnpackedHypermediaId}) {
  const discussion = useDiscussion(id);
  if (!discussion) return null;
  const {commentGroups, commentAuthors} = discussion;
  if (!commentGroups) return null;
  return commentGroups.map((commentGroup) => {
    return (
      <CommentGroup
        key={commentGroup.id}
        docId={id}
        commentGroup={commentGroup}
        isLastGroup={commentGroup === commentGroups.at(-1)}
        authors={commentAuthors}
        renderCommentContent={renderCommentContent}
        CommentReplies={CommentReplies}
      />
    );
  });
}

function renderCommentContent(comment: HMComment) {
  return (
    <WebDocContentProvider>
      <BlocksContent blocks={comment.content} parentBlockId={null} />
    </WebDocContentProvider>
  );
}

function CommentReplies({
  docId,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId;
  replyCommentId: string;
}) {
  const discussion = useDiscussion(docId, replyCommentId);
  if (!discussion) return null;
  const {commentGroups, commentAuthors} = discussion;
  if (!commentGroups) return null;
  return (
    <YStack paddingLeft={22}>
      {commentGroups.map((commentGroup) => {
        return (
          <CommentGroup
            isNested
            key={commentGroup.id}
            docId={docId}
            authors={commentAuthors}
            renderCommentContent={renderCommentContent}
            commentGroup={commentGroup}
            isLastGroup={commentGroup === commentGroups.at(-1)}
            CommentReplies={CommentReplies}
          />
        );
      })}
    </YStack>
  );
}

function DocumentOutline({
  document,
  onClose,
}: {
  document: HMDocument;
  onClose?: () => void;
}) {
  const outline = useMemo(() => {
    return getNodesOutline(document.content);
  }, [document.content]);

  return (
    <YStack gap="$3">
      {outline.map((node) => (
        <OutlineNode node={node} key={node.id} onClose={onClose} />
      ))}
    </YStack>
  );
}

function OutlineNode({
  node,
  onClose,
}: {
  node: NodeOutline;
  onClose?: () => void;
}) {
  return (
    <>
      <ButtonText
        tag="a"
        href={`#${node.id}`}
        color="$color9"
        fontSize={14}
        onPress={(e: MouseEvent) => {
          e.preventDefault();
          const targetElement = document.querySelector(`#${node.id}`);

          if (targetElement) {
            const offset = 80; // header fixed height
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.scrollY - offset;
            window.scrollTo({top: offsetPosition, behavior: "smooth"});
            onClose?.();
          }
        }}
      >
        {node.title}
      </ButtonText>
      {node.children?.length ? (
        <YStack gap="$1" paddingLeft="$4">
          {node.children.map((child) => (
            <OutlineNode node={child} key={child.id} />
          ))}
        </YStack>
      ) : null}
    </>
  );
}

function MobileOutline({
  open,
  onClose,
  children,
}: PropsWithChildren<{open: boolean; onClose: () => void}>) {
  return open ? (
    <YStack
      fullscreen
      zi={10000}
      position="fixed"
      pointerEvents={open ? "inherit" : "none"}
    >
      <XStack
        id="menu-overlay"
        fullscreen
        bg="black"
        opacity={open ? 0.6 : 0}
        onPress={onClose}
        animation="fast"
      />

      <YStack
        fullscreen
        x={open ? 50 : "100%"}
        animation="medium"
        elevation="$4"
        p="$4"
        bg="$background"
        paddingRight={50 + 18}
      >
        <XStack>
          <XStack f={1} />
          <Button icon={X} onPress={onClose} />
        </XStack>
        <ScrollView paddingVertical="$6">{children}</ScrollView>
      </YStack>
    </YStack>
  ) : null;
}
