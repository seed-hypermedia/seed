import {hmId, sortNewsEntries} from "@shm/shared";
import {Container} from "@shm/ui/src/container";
import {BannerNewspaperCard, NewspaperCard} from "@shm/ui/src/newspaper";
import {SiteNavigationContent} from "@shm/ui/src/site-navigation";
import {XStack, YStack} from "@tamagui/stacks";
import {useCallback} from "react";
import {SiteDocumentPayload} from "./loaders";
import {PageFooter} from "./page-footer";
import {SiteHeader} from "./page-header";
import {MobileSearchUI} from "./search";

export function NewspaperPage(props: SiteDocumentPayload) {
  const {
    document,
    homeId,
    homeMetadata,
    id,
    supportDocuments,
    supportQueries,
    authors,
    siteHost,
  } = props;
  if (!id) return null;
  if (!document) return null;
  if (document.metadata.layout !== "Seed/Experimental/Newspaper") {
    return null;
  }
  const newsQuery = supportQueries?.find((q) => {
    return q.in.uid === id.uid && q.in.path?.join("/") === id.path?.join("/");
  });
  if (!newsQuery) return null;

  function getEntity(path: string[]) {
    return supportDocuments?.find(
      (item) => item?.id?.path?.join("/") === path?.join("/")
    );
  }

  const sortedItems = sortNewsEntries(
    newsQuery.results,
    homeMetadata.seedExperimentalHomeOrder
  );
  const firstItem = sortedItems[0];
  const restItems = sortedItems.slice(1);

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
    <>
      <YStack marginBottom={300}>
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
          <SiteNavigationContent
            supportDocuments={props.supportDocuments}
            supportQueries={props.supportQueries}
            document={document}
            id={id}
            onActivateBlock={onActivateBlock}
          />
        </SiteHeader>
        <Container
          clearVerticalSpace
          maxWidth={1000}
          marginTop={60}
          marginBottom={80}
        >
          {firstItem && (
            <BannerNewspaperCard
              item={firstItem}
              entity={getEntity(firstItem.path)}
              accountsMetadata={authors}
            />
          )}
          <XStack
            flexWrap="wrap"
            marginTop="$4"
            justifyContent="center"
            gap="$6"
          >
            {restItems.map((item) => {
              const itemId = hmId("d", item.account, {path: item.path});
              return (
                <NewspaperCard
                  id={itemId}
                  entity={getEntity(item.path)}
                  key={itemId.id}
                  accountsMetadata={authors}
                />
              );
            })}
          </XStack>
        </Container>
      </YStack>
      <PageFooter id={id} />
    </>
  );
}
