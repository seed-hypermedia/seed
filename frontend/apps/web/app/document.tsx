import {HeadersFunction, MetaFunction} from "@remix-run/node";
import {useLocation, useNavigate} from "@remix-run/react";
import {
  BlockRange,
  createWebHMUrl,
  formattedDateMedium,
  getDocumentTitle,
  HMComment,
  HMDocument,
  HMEntityContent,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  HMQueryResult,
  SITE_BASE_URL,
  UnpackedHypermediaId,
  unpackHmId,
} from "@shm/shared";
import {getActivityTime} from "@shm/shared/models/activity";
import "@shm/shared/styles/document.css";
import {
  ActivitySection,
  BlocksContent,
  Button,
  ChangeGroup,
  CommentGroup,
  Container,
  DocContent,
  DocContentProvider,
  DocDirectory,
  DocumentOutline,
  extractIpfsUrlCid,
  getRandomColor,
  SubDocumentItem,
  useImageUrl,
  useTheme,
} from "@shm/ui";
import {documentContainerClassName} from "@shm/ui/src/document-content";
import {ChevronUp} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import React, {lazy, useCallback, useEffect, useMemo, useState} from "react";
import {getHref} from "./href";
import type {SiteDocumentPayload} from "./loaders";
import {defaultSiteIcon} from "./meta";
import {useActivity, useDiscussion} from "./models";
import {NewspaperPage} from "./newspaper";
import {NotFoundPage} from "./not-found";
import {PageFooter} from "./page-footer";
import {PageHeader, WebSiteHeader} from "./page-header";
import {getOptimizedImageUrl, WebSiteProvider} from "./providers";
import {EmbedDocument, EmbedInline, QueryBlockWeb} from "./web-embeds";
import {unwrap, Wrapped} from "./wrapping";

export const documentPageHeaders: HeadersFunction = ({loaderHeaders}) =>
  loaderHeaders;

export const documentPageMeta: MetaFunction = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload>;
}) => {
  const siteDocument = unwrap<SiteDocumentPayload>(data);
  const homeIcon = siteDocument?.homeMetadata?.icon
    ? getOptimizedImageUrl(
        extractIpfsUrlCid(siteDocument.homeMetadata.icon),
        "S"
      )
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
    enableWebSigning,
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
      <WebSiteProvider homeId={props.homeId}>
        <NewspaperPage {...props} />;
      </WebSiteProvider>
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

  const isHomeDoc = !id.path?.length;
  const isShowOutline =
    (typeof document.metadata.showOutline == "undefined" ||
      document.metadata.showOutline) &&
    !isHomeDoc;
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc;

  const location = useLocation();
  const replace = useNavigate();
  const match = location.hash.match(/^(.+?)(?:\[(\d+):(\d+)\])?$/);
  const blockRef = match ? match[1].substring(1) : undefined;

  const blockRange =
    match && match[2] && match[3]
      ? {start: parseInt(match[2]), end: parseInt(match[3])}
      : undefined;

  return (
    <WebSiteProvider homeId={props.homeId}>
      <YStack>
        <WebSiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
        >
          <DocumentCover cover={document.metadata.cover} id={id} />
          <YStack
            className={documentContainerClassName(
              showSidebarOutlineDirectory,
              document.metadata?.contentWidth
            )}
          >
            {showSidebarOutlineDirectory ? (
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
                  <DocumentOutline
                    onActivateBlock={onActivateBlock}
                    document={document}
                    id={id}
                    // onCloseNav={() => {}}
                    supportDocuments={props.supportDocuments}
                    activeBlockId={id.blockRef}
                  />
                  <DocDirectory
                    // supportDocuments={props.supportDocuments}
                    supportQueries={props.supportQueries}
                    // documentMetadata={document.metadata}
                    id={id}
                  />
                </YStack>
              </YStack>
            ) : null}
            <YStack>
              {isHomeDoc ? null : (
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
              )}
              <WebDocContentProvider
                homeId={homeId}
                id={{...id, version: document.version}}
                siteHost={siteHost}
                supportDocuments={supportDocuments}
                supportQueries={supportQueries}
                routeParams={{
                  blockRef: blockRef,
                  blockRange: blockRange,
                }}
              >
                <DocContent
                  document={document}
                  handleBlockReplace={() => {
                    // Replace the URL to not include fragment.
                    replace(location.pathname + location.search, {
                      replace: true,
                    });
                    return true;
                  }}
                />
              </WebDocContentProvider>
              {document.metadata &&
              document.metadata.showActivity === false ? null : (
                <DocumentAppendix
                  id={id}
                  document={document}
                  homeId={homeId}
                  siteHost={siteHost}
                  enableWebSigning={enableWebSigning}
                />
              )}
            </YStack>
          </YStack>
        </WebSiteHeader>
      </YStack>
      <PageFooter id={id} />
    </WebSiteProvider>
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
  const imageUrl = useImageUrl();
  if (!cover) return null;

  return (
    <XStack
      backgroundColor={coverBg}
      height="25vh"
      width="100%"
      position="relative"
    >
      <img
        src={imageUrl(cover, "XL")}
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
  routeParams,
}: {
  siteHost: string | undefined;
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  children: React.ReactNode;
  supportDocuments?: HMEntityContent[];
  supportQueries?: HMQueryResult[];
  routeParams?: {
    documentId?: string;
    version?: string;
    blockRef?: string;
    blockRange?: BlockRange;
  };
}) {
  const navigate = useNavigate();
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
        const blockHref = getHref(
          homeId,
          {
            ...id,
            hostname: siteHost || null,
            blockRange: blockRange || null,
            blockRef: blockId,
          },
          id.version || undefined
        );
        window.navigator.clipboard.writeText(blockHref);
        // window.history.replaceState(
        //   null,
        //   "",
        //   window.location.pathname +
        //     window.location.search +
        //     `#${blockId}[${blockRange.start}:${blockRange.end}]`
        // );
        navigate(
          window.location.pathname +
            window.location.search +
            `#${blockId}${
              blockRange.start && blockRange.end
                ? `[${blockRange.start}:${blockRange.end}]`
                : ""
            }`,
          {replace: true}
        );
      }}
      routeParams={routeParams}
      textUnit={18}
      layoutUnit={24}
      debug={false}
    >
      {children}
    </DocContentProvider>
  );
}

const WebCommenting = lazy(async () => await import("./commenting"));

function DocumentAppendix({
  id,
  document,
  homeId,
  siteHost,
  enableWebSigning,
}: {
  id: UnpackedHypermediaId;
  document: HMDocument;
  homeId: UnpackedHypermediaId;
  siteHost: string | undefined;
  enableWebSigning?: boolean;
}) {
  return (
    <Container>
      <ActivitySection>
        <DocumentActivity
          id={id}
          document={document}
          homeId={homeId}
          siteHost={siteHost}
        />

        {enableWebSigning ? (
          <WebCommenting docId={id} docVersion={document.version} />
        ) : null}
      </ActivitySection>
    </Container>
  );
}

function DocumentActivity({
  id,
  homeId,
  document,
  siteHost,
}: {
  id: UnpackedHypermediaId;
  homeId: UnpackedHypermediaId;
  document: HMDocument;
  siteHost: string | undefined;
}) {
  const activity = useActivity(id);
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
  const [visibleCount, setVisibleCount] = useState(10);
  const activeChangeIds = new Set<string>(document.version?.split(".") || []);
  const activityItems = activity.data?.activity;
  const accountsMetadata = activity.data?.accountsMetadata;
  const latestDocChanges = new Set<string>(
    activity.data?.latestVersion?.split(".") || []
  );
  if (!activityItems || !accountsMetadata) return null;
  if (!activity) return null;
  const prevActivity = activityItems.at(-visibleCount);
  const prevActivityTime = prevActivity && getActivityTime(prevActivity);

  return (
    <>
      {visibleCount < activityItems.length && prevActivity && (
        <Button
          onPress={() => setVisibleCount((count) => count + 10)}
          size="$2"
          icon={ChevronUp}
        >
          {prevActivityTime
            ? `Activity before ${formattedDateMedium(prevActivityTime)}`
            : "Previous Activity"}
        </Button>
      )}
      {activityItems.slice(-visibleCount).map((activityItem, index) => {
        if (activityItem.type === "commentGroup") {
          return (
            <CommentGroup
              key={activityItem.id}
              docId={id}
              commentGroup={activityItem}
              isLastGroup={index === activityItems.length - 1}
              authors={activity.data?.accountsMetadata}
              renderCommentContent={renderCommentContent}
              CommentReplies={CommentReplies}
              homeId={homeId}
              siteHost={siteHost}
            />
          );
        }
        if (activityItem.type === "document") {
          return (
            <SubDocumentItem
              item={activityItem}
              siteHomeId={homeId}
              accountsMetadata={accountsMetadata}
              markedAsRead
            />
          );
        }
        if (activityItem.type === "changeGroup") {
          const author =
            activity.data?.accountsMetadata?.[activityItem.changes[0].author];
          if (!author) return null;
          return (
            <ChangeGroup
              item={activityItem}
              key={activityItem.id}
              latestDocChanges={latestDocChanges}
              activeChangeIds={activeChangeIds}
              docId={id}
              author={author}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function CommentReplies({
  docId,
  homeId,
  siteHost,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId;
  homeId?: UnpackedHypermediaId;
  siteHost?: string | undefined;
  replyCommentId: string;
}) {
  const discussion = useDiscussion(docId, replyCommentId);
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        homeId && (
          <WebDocContentProvider homeId={homeId} id={docId} siteHost={siteHost}>
            <BlocksContent blocks={comment.content} parentBlockId={null} />
          </WebDocContentProvider>
        )
      );
    },
    [homeId]
  );
  if (!discussion.data) return null;
  const {commentGroups, commentAuthors} = discussion.data;
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
