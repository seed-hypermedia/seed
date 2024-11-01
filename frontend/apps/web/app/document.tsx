import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {
  getDocumentTitle,
  getFileUrl,
  getMetadataName,
  getNodesOutline,
  HMComment,
  HMDocument,
  hmId,
  HMMetadata,
  HMQueryResult,
  NodeOutline,
  UnpackedHypermediaId,
} from "@shm/shared";
import {SiteRoutingProvider, useRouteLink} from "@shm/shared/src/routing";
import {SideNavigationPlaceholder} from "@shm/shared/src/site-navigation";
import "@shm/shared/src/styles/document.css";
import {getRandomColor} from "@shm/ui/src/avatar";
import {Container} from "@shm/ui/src/container";
import {DirectoryItem} from "@shm/ui/src/directory";
import {CommentGroup} from "@shm/ui/src/discussion";
import {
  BlocksContent,
  DocContent,
  DocContentProvider,
} from "@shm/ui/src/document-content";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {SmallListItem} from "@shm/ui/src/list-item";
import {RadioButtons} from "@shm/ui/src/radio-buttons";
import {Button} from "@tamagui/button";
import {GestureReponderEvent, Text, useMedia} from "@tamagui/core";
import {X} from "@tamagui/lucide-icons";
import {ScrollView} from "@tamagui/scroll-view";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useCallback, useEffect, useMemo, useState} from "react";
import {getHref} from "./href";
import type {SiteDocumentPayload} from "./loaders";
import {defaultSiteIcon} from "./meta";
import {NewspaperPage} from "./newspaper";
import {NotFoundPage} from "./not-found";
import {PageFooter} from "./page-footer";
import {PageHeader, SiteHeader} from "./page-header";
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
  const homeIcon = siteDocument?.homeMetadata?.icon
    ? getFileUrl(siteDocument.homeMetadata.icon)
    : null;
  const meta: ReturnType<MetaFunction> = [];

  meta.push({
    tagName: "link",
    rel: "icon",
    href: homeIcon || defaultSiteIcon,
    type: "image/png",
  });

  if (!siteDocument) return meta;

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

export function DocumentPage(props: SiteDocumentPayload) {
  const media = useMedia();
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
  if (document.metadata.layout === "Seed/Experimental/Newspaper") {
    return (
      <SiteRoutingProvider homeId={props.homeId}>
        <NewspaperPage {...props} />;
      </SiteRoutingProvider>
    );
  }
  return (
    <SiteRoutingProvider homeId={props.homeId}>
      <YStack>
        <SiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docMetadata={document.metadata}
          docId={id}
          breadcrumbs={props.breadcrumbs}
          supportQueries={props.supportQueries}
          openSheet={() => {
            setOpen(!open);
          }}
        />
        <DocumentCover cover={document.metadata.cover} />
        <YStack className="document-container">
          {media.gtSm ? (
            <YStack
              marginTop={200}
              $gtSm={{marginTop: 160}}
              className="document-aside"
            >
              <SiteNavigation
                supportDocuments={props.supportDocuments}
                supportQueries={props.supportQueries}
                document={document}
                id={id}
              />
            </YStack>
          ) : null}
          <YStack>
            <PageHeader
              homeId={homeId}
              docMetadata={document.metadata}
              docId={id}
              authors={authors}
              updateTime={document.updateTime}
            />
            <WebDocContentProvider homeId={homeId} id={id} siteHost={siteHost}>
              <DocContent document={document} />
            </WebDocContentProvider>
            <DocumentAppendix id={id} homeId={homeId} siteHost={siteHost} />
          </YStack>
        </YStack>
        <PageFooter id={id} />
      </YStack>

      <MobileOutline open={open} onClose={() => setOpen(false)}>
        <SiteNavigation
          document={document}
          onClose={() => setOpen(false)}
          id={id}
        />
      </MobileOutline>
    </SiteRoutingProvider>
  );
}

function DocumentCover({
  cover,
  id,
}: {
  cover: HMMetadata["cover"];
  id: UnpackedHypermediaId | null;
}) {
  const coverBg = useMemo(() => {
    if (id?.id) {
      return getRandomColor(id.id);
    }

    return "black";
  }, [id]);
  if (!cover) return null;

  return (
    <XStack bg={coverBg} height="25vh" width="100%" position="relative">
      <img
        src={getFileUrl(cover)}
        title={"cover image"}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          objectFit: "cover",
        }}
      />
    </XStack>
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
      <PageFooter id={id} />
    </YStack>
  );
}

function WebDocContentProvider({
  children,
  id,
  homeId,
  siteHost,
}: {
  siteHost: string | undefined;
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  children: React.JSX.Element;
}) {
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
  // if (activeTab === "directory") {
  //   content = <DocumentDirectory id={id} homeId={homeId} />;
  // } else if (activeTab === "discussion") {
  content = <DocumentDiscussion id={id} homeId={homeId} siteHost={siteHost} />;
  // }
  return (
    <Container>
      <RadioButtons
        value={activeTab}
        options={
          [
            {key: "discussion", label: "Discussion"},
            // {key: "directory", label: "Directory"},
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

function DocumentSmallListItem({
  metadata,
  id,
  indented,
}: {
  metadata?: HMMetadata;
  id: UnpackedHypermediaId;
  indented?: number;
}) {
  const linkProps = useRouteLink({key: "document", id});
  return (
    <SmallListItem
      key={id.id}
      title={getMetadataName(metadata)}
      icon={<HMIcon id={id} metadata={metadata} size={20} />}
      indented={indented}
      {...linkProps}
    />
  );
}

function SiteNavigation({
  document,
  supportDocuments,
  supportQueries,
  onClose,
  id,
}: {
  document: HMDocument;
  onClose?: () => void;
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[];
  supportQueries?: HMQueryResult[];
  id: UnpackedHypermediaId;
}) {
  const media = useMedia();
  const outline = useMemo(() => {
    return getNodesOutline(document.content);
  }, [document.content]);

  const directory = supportQueries?.find(
    (query) => query.in.uid === document.account
  );
  const isTopLevel = !id.path || id.path?.length === 0;

  const parentId = hmId(id.type, id.uid, {
    path: id.path?.slice(0, -1) || [],
  });
  if (!directory) return null;
  const parentListItem = directory.results.find(
    (doc) => doc.path.join("/") === parentId.path?.join("/")
  );
  const parentIdPath = parentId.path;
  const idPath = id.path;
  const siblingDocs =
    parentIdPath &&
    directory.results.filter(
      (doc) =>
        doc.path.join("/").startsWith(parentIdPath.join("/")) &&
        parentIdPath.length === doc.path.length - 1 &&
        doc.path.join("/") !== idPath?.join("/")
    );
  const childrenDocs =
    idPath &&
    directory.results.filter(
      (doc) =>
        doc.path.join("/").startsWith(idPath.join("/")) &&
        idPath.length === doc.path.length - 1
    );
  const documentIndent = isTopLevel ? 0 : 1;
  if (media.gtSm) {
    return (
      <YStack gap="$2" paddingLeft="$4">
        {isTopLevel || !parentListItem ? null : (
          <DocumentSmallListItem
            metadata={parentListItem.metadata}
            id={parentId}
          />
        )}
        <DocumentSmallListItem
          metadata={document.metadata}
          id={id}
          indented={documentIndent}
        />
        {outline.map((node) => (
          <OutlineNode
            node={node}
            key={node.id}
            onClose={onClose}
            indented={documentIndent}
          />
        ))}
        {childrenDocs?.map((doc) => (
          <DocumentSmallListItem
            key={doc.path.join("/")}
            metadata={doc.metadata}
            id={hmId("d", doc.account, {path: doc.path})}
            indented={2}
          />
        ))}
        {siblingDocs?.map((doc) => (
          <DocumentSmallListItem
            key={doc.path.join("/")}
            metadata={doc.metadata}
            id={hmId("d", doc.account, {path: doc.path})}
            indented={1}
          />
        ))}
      </YStack>
    );
  } else {
    return <SideNavigationPlaceholder />;
  }
}

function OutlineNode({
  node,
  onClose,
  indented = 0,
}: {
  node: NodeOutline;
  onClose?: () => void;
  indented?: number;
}) {
  return (
    <>
      <SmallListItem
        key={node.id}
        title={node.title}
        // icon={<HMIcon id={node.id} metadata={node.metadata} size={20} />}
        indented={indented}
        onPress={(e: GestureReponderEvent) => {
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
      />
      {node.children?.length
        ? node.children.map((child) => (
            <OutlineNode node={child} key={child.id} indented={indented + 1} />
          ))
        : null}
    </>
  );
}

function MobileOutline({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.JSX.Element;
}) {
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
