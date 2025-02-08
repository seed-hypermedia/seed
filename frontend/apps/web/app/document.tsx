import {MetaFunction} from "@remix-run/node";
import {
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
import {getActivityTime} from "@shm/shared/src/models/activity";
import {SiteRoutingProvider} from "@shm/shared/src/routing";
import "@shm/shared/src/styles/document.css";
import {Button, getRandomColor, useImageUrl, useTheme} from "@shm/ui/src";
import {ChangeGroup, SubDocumentItem} from "@shm/ui/src/activity";
import {Container} from "@shm/ui/src/container";
import {CommentGroup} from "@shm/ui/src/discussion";
import {
  BlocksContent,
  DocContent,
  DocContentProvider,
} from "@shm/ui/src/document-content";
import {extractIpfsUrlCid} from "@shm/ui/src/get-file-url";
import {DocDirectory, DocumentOutline} from "@shm/ui/src/navigation";
import {
  OptimizedImageSize,
  UniversalAppProvider,
} from "@shm/ui/src/universal-app";
import {ChevronUp} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {lazy, useCallback, useEffect, useMemo, useState} from "react";
import {WebCommenting} from "./commenting";
import {getHref} from "./href";
import type {SiteDocumentPayload} from "./loaders";
import {defaultSiteIcon} from "./meta";
import {useActivity, useDiscussion} from "./models";
import {NewspaperPage} from "./newspaper";
import {NotFoundPage} from "./not-found";
import {PageFooter} from "./page-footer";
import {PageHeader, WebSiteHeader} from "./page-header";
import {EmbedDocument, EmbedInline, QueryBlockWeb} from "./web-embeds";
import {unwrap, Wrapped} from "./wrapping";

function getOptimizedImageUrl(cid: string, size?: OptimizedImageSize) {
  let url = `/hm/api/image/${cid}`;
  if (size) url += `?size=${size}`;
  return url;
}

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

function WebSiteProvider(props: {
  homeId: UnpackedHypermediaId;
  children: React.ReactNode;
  siteHost?: string;
}) {
  return (
    <UniversalAppProvider
      homeId={props.homeId}
      getOptimizedImageUrl={getOptimizedImageUrl}
    >
      <SiteRoutingProvider homeId={props.homeId}>
        {props.children}
      </SiteRoutingProvider>
    </UniversalAppProvider>
  );
}

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
            className={`document-container${
              typeof document.metadata.showOutline == "undefined" ||
              document.metadata.showOutline
                ? ""
                : " hide-outline"
            }`}
          >
            {typeof document.metadata.showOutline == "undefined" ||
            document.metadata.showOutline ? (
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
              <DocumentAppendix
                id={id}
                document={document}
                homeId={homeId}
                siteHost={siteHost}
                enableWebSigning={enableWebSigning}
              />
            </YStack>
          </YStack>
          <PageFooter id={id} />
        </WebSiteHeader>
      </YStack>
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
      <YStack paddingVertical="$6" marginBottom={100} gap="$4">
        <SizableText fontSize={20} fontWeight="600">
          Activity
        </SizableText>
        <DocumentActivity
          id={id}
          document={document}
          homeId={homeId}
          siteHost={siteHost}
        />
      </YStack>
      {enableWebSigning ? <WebCommenting docId={id} /> : null}
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
