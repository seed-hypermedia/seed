import {MetaFunction} from "@remix-run/node";
import {useFetcher} from "@remix-run/react";
import {
  createWebHMUrl,
  getDocumentTitle,
  getFileUrl,
  HMComment,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from "@shm/shared";
import {SiteRoutingProvider} from "@shm/shared/src/routing";
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
import {EmptyDiscussion} from "@shm/ui/src/icons";
import {Text} from "@tamagui/core";
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
import type {DirectoryPayload} from "./routes/hm.api.directory";
import {DiscussionPayload} from "./routes/hm.api.discussion";
import {MobileSearchUI} from "./search";
import {SiteNavigation} from "./site-navigation";
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
  if (document.metadata.layout == "Seed/Experimental/Newspaper") {
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
          mobileSearchUI={<MobileSearchUI homeId={homeId} />}
          isWeb
        >
          <SiteNavigation
            supportDocuments={props.supportDocuments}
            supportQueries={props.supportQueries}
            document={document}
            id={id}
          />
        </SiteHeader>

        <DocumentCover cover={document.metadata.cover} id={id} />
        <YStack className="document-container">
          <YStack
            marginTop={200}
            $gtSm={{marginTop: 124}}
            className="document-aside"
          >
            <SiteNavigation
              supportDocuments={props.supportDocuments}
              supportQueries={props.supportQueries}
              document={document}
              id={id}
            />
          </YStack>

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
    <XStack
      backgroundColor={coverBg}
      height="25vh"
      width="100%"
      position="relative"
    >
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
        homeMetadata={homeMetadata || null}
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
        />
      );
    })
  ) : (
    <YStack padding="$4" jc="center" ai="center" gap="$4">
      <EmptyDiscussion />
      <SizableText color="$color7" fontWeight="500">
        there are no active discussions
      </SizableText>
    </YStack>
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
