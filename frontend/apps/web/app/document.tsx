import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {
  createWebHMUrl,
  getDocumentTitle,
  getFileUrl,
  getMetadataName,
  HMComment,
  HMEntityContent,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  HMQueryResult,
  NodeOutline,
  SITE_BASE_URL,
  UnpackedHypermediaId,
  unpackHmId,
} from "@shm/shared";
import {SiteRoutingProvider, useRouteLink} from "@shm/shared/src/routing";
import "@shm/shared/src/styles/document.css";
import {X} from "@shm/ui";
import {getRandomColor} from "@shm/ui/src/avatar";
import {Container} from "@shm/ui/src/container";
import {CommentGroup} from "@shm/ui/src/discussion";
import {
  BlocksContent,
  DocContent,
  DocContentProvider,
} from "@shm/ui/src/document-content";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {EmptyDiscussion} from "@shm/ui/src/icons";
import {SmallListItem} from "@shm/ui/src/list-item";
import {
  DocNavigationContent,
  DocumentOutline,
  SiteNavigationContent,
} from "@shm/ui/src/navigation";
import {Button} from "@tamagui/button";
import {GestureReponderEvent, Text, useTheme} from "@tamagui/core";
import {ScrollView} from "@tamagui/scroll-view";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useCallback, useEffect, useMemo} from "react";
import {getHref} from "./href";
import type {SiteDocumentPayload} from "./loaders";
import {defaultSiteIcon} from "./meta";
import {NewspaperPage} from "./newspaper";
import {NotFoundPage} from "./not-found";
import {PageFooter} from "./page-footer";
import {PageHeader, SiteHeader} from "./page-header";
import {DiscussionPayload} from "./routes/hm.api.discussion";
import {MobileSearchUI} from "./search";
import {EmbedDocument, EmbedInline, QueryBlockWeb} from "./web-embeds";
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

    meta.push({
      property: "og:image",
      content: `${SITE_BASE_URL}/hm/api/content-image?space=${
        siteDocument.id.uid
      }&path=${hmIdPathToEntityQueryPath(siteDocument.id.path)}&version=${
        siteDocument.id.version
      }`,
    });
    // meta.push({ // TODO
    //   property: "og:image:alt",
    //   content: "Description of the image for accessibility.",
    // });
  } else {
    meta.push({title: "Not Found"});
  }
  return meta;
};

export function DocumentPage(props: SiteDocumentPayload) {
  const {
    document,
    homeId,
    homeMetadata,
    id,
    siteHost,
    supportDocuments,
    supportQueries,
    accountsMetadata,
  } = props;
  if (!id) return <NotFoundPage {...props} />;
  if (!document)
    return (
      <DocumentDiscoveryPage
        id={id}
        homeId={homeId}
        homeMetadata={homeMetadata}
      />
    );
  if (document.metadata.layout == "Seed/Experimental/Newspaper") {
    return (
      <SiteRoutingProvider homeId={props.homeId}>
        <NewspaperPage {...props} />;
      </SiteRoutingProvider>
    );
  }
  const onActivateBlock = useCallback((blockId: string) => {
    const targetElement = window.document.querySelector(`#${blockId}`);

    if (targetElement) {
      const offset = 80; // header fixed height
      const elementPosition = targetElement.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - offset;
      window.scrollTo({top: offsetPosition, behavior: "smooth"});
      // onClose?.();
    }
  }, []);
  const docNavigation = (
    <DocNavigationContent
      supportDocuments={props.supportDocuments}
      supportQueries={props.supportQueries}
      documentMetadata={document.metadata}
      id={id}
      outline={({indented}) => (
        <DocumentOutline
          onActivateBlock={onActivateBlock}
          document={document}
          id={id}
          supportDocuments={props.supportDocuments}
          activeBlockId={id.blockRef}
          indented={indented}
        />
      )}
    />
  );
  const siteNavigation =
    !!id.path?.length &&
    homeMetadata.layout !== "Seed/Experimental/Newspaper" ? null : (
      <SiteNavigationContent
        homeId={homeId}
        supportQueries={props.supportQueries}
      />
    );
  return (
    <SiteRoutingProvider homeId={props.homeId}>
      <YStack>
        <SiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docMetadata={document.metadata}
          docId={id}
          supportQueries={props.supportQueries}
          mobileSearchUI={<MobileSearchUI homeId={homeId} />}
          isWeb
        >
          {siteNavigation}
          {docNavigation}
        </SiteHeader>

        <DocumentCover cover={document.metadata.cover} id={id} />
        <YStack className="document-container">
          <YStack
            marginTop={200}
            $gtSm={{marginTop: 124}}
            className="document-aside"
            height="calc(100vh - 150px)"
          >
            <YStack
              className="hide-scrollbar"
              overflow="scroll"
              height="100%"
              // paddingTop={32}
              paddingBottom={32}
            >
              {docNavigation}
            </YStack>
          </YStack>

          <YStack>
            <PageHeader
              homeId={homeId}
              breadcrumbs={props.breadcrumbs}
              docMetadata={document.metadata}
              docId={id}
              authors={document.authors.map(
                (author) => accountsMetadata[author]
              )}
              updateTime={document.updateTime}
            />
            <WebDocContentProvider
              homeId={homeId}
              id={id}
              siteHost={siteHost}
              supportDocuments={supportDocuments}
              supportQueries={supportQueries}
            >
              <DocContent document={document} />
            </WebDocContentProvider>
            <DocumentAppendix id={id} homeId={homeId} siteHost={siteHost} />
          </YStack>
        </YStack>
        <PageFooter id={id} />
      </YStack>
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
  supportDocuments,
  supportQueries,
}: {
  siteHost: string | undefined;
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  children: React.ReactNode;
  supportDocuments?: HMEntityContent[];
  supportQueries?: HMQueryResult[];
}) {
  return (
    <DocContentProvider
      entityComponents={{
        Document: EmbedDocument,
        Comment: () => null,
        Inline: EmbedInline,
        Query: QueryBlockWeb,
      }}
      entityId={id}
      supportDocuments={supportDocuments}
      supportQueries={supportQueries}
      onLinkClick={(href, e) => {
        e.preventDefault();
        e.stopPropagation();

        const unpackedId = unpackHmId(href);
        if (unpackedId) {
          const {uid, path, version, latest, blockRef, blockRange, type} =
            unpackedId;
          const hmUrl = createWebHMUrl(type, uid, {
            version,
            blockRef,
            blockRange,
            hostname: siteHost,
            latest,
            path,
          });
          window.open(hmUrl, "_self");
        } else window.open(href, "_blank");
      }}
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
  return (
    <Container>
      <YStack paddingVertical="$6" marginBottom={100} gap="$4">
        <SizableText fontSize={20} fontWeight="600">
          Discussions
        </SizableText>
        <DocumentDiscussion id={id} homeId={homeId} siteHost={siteHost} />
      </YStack>
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
  const theme = useTheme();
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
  return commentGroups.length > 0 ? (
    commentGroups.map((commentGroup) => {
      return (
        <CommentGroup
          key={commentGroup.id}
          docId={id}
          commentGroup={commentGroup}
          isLastGroup={commentGroup === commentGroups.at(-1)}
          authors={commentAuthors}
          renderCommentContent={renderCommentContent}
          CommentReplies={CommentReplies}
          homeId={homeId}
          siteHost={siteHost}
        />
      );
    })
  ) : (
    <YStack padding="$4" jc="center" ai="center" gap="$4">
      <EmptyDiscussion color={theme.color7?.val} />
      <SizableText color="$color7" fontWeight="500">
        There are no active discussions
      </SizableText>
    </YStack>
  );
}

function CommentReplies({
  docId,
  homeId,
  siteHost,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  siteHost: string | undefined;
  replyCommentId: string;
}) {
  const discussion = useDiscussion(docId, replyCommentId);
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider homeId={homeId} id={docId} siteHost={siteHost}>
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      );
    },
    [homeId]
  );
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
            homeId={homeId}
            siteHost={siteHost}
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

function MobileSiteNavigation({
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
      // @ts-ignore
      position="fixed"
      // @ts-ignore
      pointerEvents={open ? "inherit" : "none"}
      backgroundColor="$background"
    >
      <XStack>
        <XStack flex={1} />
        <Button icon={<X width={20} height={20} />} onPress={onClose} />
      </XStack>
      <ScrollView paddingVertical="$6" paddingHorizontal="$4">
        {children}
      </ScrollView>
    </YStack>
  ) : null;
}
