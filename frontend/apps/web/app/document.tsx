import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {
  getDocumentTitle,
  getFileUrl,
  getNodesOutline,
  HMComment,
  HMDocument,
  HMMetadata,
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
import {Button, ButtonText} from "@tamagui/button";
import {Text} from "@tamagui/core";
import {X} from "@tamagui/lucide-icons";
import {ScrollView} from "@tamagui/scroll-view";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {getHref} from "./href";
import type {SiteDocumentPayload} from "./loaders";
import {NotFoundPage} from "./not-found";
import {PageHeader} from "./page-header";
import type {DirectoryPayload} from "./routes/hm.api.directory";
import {DiscussionPayload} from "./routes/hm.api.discussion";
import {EmbedDocument, EmbedInline} from "./web-embeds";
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
  const meta: ReturnType<MetaFunction> = [];
  if (homeThumbnail) {
    meta.push({
      tagName: "link",
      rel: "icon",
      href: homeThumbnail,
      type: "image/png",
    });
  }
  if (siteDocument.id)
    meta.push({
      name: "hypermedia_id",
      content: siteDocument.id.id,
    });
  if (siteDocument.document) {
    meta.push({title: getDocumentTitle(siteDocument.document)});

    meta.push({
      name: "hypermedia_version",
      content: siteDocument.document.version,
    });
    meta.push({
      name: "hypermedia_title",
      content: getDocumentTitle(siteDocument.document),
    });
  } else {
    meta.push({title: "Not Found"});
  }
  return meta;
};

const outlineWidth = 172;
export function DocumentPage(props: SiteDocumentPayload) {
  const [open, setOpen] = useState(false);
  const {document, homeId, homeMetadata, id, authors, siteHost} = props;
  if (!id) return <NotFoundPage {...props} />;
  if (!document)
    return (
      <DocumentDiscoveryPage
        id={id}
        homeId={homeId}
        homeMetadata={homeMetadata}
      />
    );
  return (
    <>
      <YStack marginBottom={300}>
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
            <WebDocContentProvider homeId={homeId} id={id} siteHost={siteHost}>
              <DocContent document={document} />
            </WebDocContentProvider>
          </Container>
          <DocumentAppendix id={id} homeId={homeId} siteHost={siteHost} />
        </YStack>
      </YStack>
      <MobileOutline open={open} onClose={() => setOpen(false)}>
        <DocumentOutline document={document} onClose={() => setOpen(false)} />
      </MobileOutline>
    </>
  );
}

function DocumentDiscoveryPage({
  id,
  homeMetadata,
  homeId,
}: {
  id: UnpackedHypermediaId;
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
}) {
  useEffect(() => {
    fetch("/hm/api/discover", {
      method: "post",
      body: JSON.stringify({uid: id.uid, path: id.path, version: id.version}),
      headers: {
        "Content-Type": "application/json",
      },
    }).then(() => {
      window.location.reload();
    });
  }, [id]);
  return (
    <YStack>
      <PageHeader
        homeMetadata={homeMetadata}
        homeId={homeId}
        docMetadata={null}
        docId={id}
        authors={[]}
        updateTime={null}
      />
      <YStack>
        <Container>
          <YStack
            alignSelf="center"
            width={600}
            gap="$5"
            borderWidth={1}
            borderColor="$color8"
            borderRadius="$4"
            padding="$5"
            elevation="$4"
          >
            <XStack alignItems="center" gap="$3">
              <SizableText size="$8" fontWeight="bold">
                Looking for a document...
              </SizableText>
            </XStack>
            <YStack gap="$3">
              <SizableText>
                Hang tight! We're currently searching the network to locate your
                document. This may take a moment as we retrieve the most
                up-to-date version.
              </SizableText>
              <SizableText>
                If the document is available, it will appear shortly. Thank you
                for your patience!
              </SizableText>
            </YStack>
          </YStack>
        </Container>
      </YStack>
    </YStack>
  );
}

function WebDocContentProvider({
  children,
  id,
  homeId,
  siteHost,
}: PropsWithChildren<{
  siteHost: string | undefined;
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
}>) {
  return (
    <DocContentProvider
      entityComponents={{
        Document: EmbedDocument,
        Comment: () => null,
        Inline: EmbedInline,
      }}
      onLinkClick={(href, e) => {}}
      onCopyBlock={(blockId, blockRange) => {
        const blockHref = getHref(homeId, {
          ...id,
          hostname: siteHost || null,
          blockRange: blockRange || null,
          blockRef: blockId,
        });
        window.navigator.clipboard.writeText(blockHref);
      }}
      saveCidAsFile={async (cid, name) => {}}
      textUnit={18}
      layoutUnit={24}
      debug={false}
    >
      {children}
    </DocContentProvider>
  );
}

function DocumentAppendix({
  id,
  homeId,
  siteHost,
}: {
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  siteHost: string | undefined;
}) {
  const [activeTab, setActiveTab] = useState<"directory" | "discussion">(
    "directory"
  );
  let content = null;
  if (activeTab === "directory") {
    content = <DocumentDirectory id={id} homeId={homeId} />;
  } else if (activeTab === "discussion") {
    content = (
      <DocumentDiscussion id={id} homeId={homeId} siteHost={siteHost} />
    );
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

function DocumentDirectory({
  id,
  homeId,
}: {
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
}) {
  const response = useAPI<DirectoryPayload>(`/hm/api/directory?id=${id.id}`);
  if (response?.error) return <ErrorComponent error={response?.error} />;
  if (!response) return null;
  const {directory, authorsMetadata} = response;
  if (!authorsMetadata) return null;
  return (
    <YStack paddingVertical="$4">
      {directory?.map((doc) => (
        <DirectoryItem
          entry={doc}
          siteHomeId={homeId}
          authorsMetadata={authorsMetadata}
          PathButtonComponent={PathButton}
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

function DocumentDiscussion({
  id,
  homeId,
  siteHost,
}: {
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  siteHost: string | undefined;
}) {
  const discussion = useDiscussion(id);
  if (!discussion) return null;
  const {commentGroups, commentAuthors} = discussion;
  if (!commentGroups) return null;
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider homeId={homeId} id={id} siteHost={siteHost}>
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      );
    },
    [homeId]
  );
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
        textDecorationLine="none"
        fontSize={14}
        hoverStyle={{
          textDecorationLine: "underline",
        }}
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
      zi="$zIndex.7"
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
