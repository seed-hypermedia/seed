import {PlainMessage, Timestamp} from "@bufbuild/protobuf";
import {Container} from "@shm/ui/src/container";
import {BannerNewspaperCard, NewspaperCard} from "@shm/ui/src/newspaper";
import {XStack, YStack} from "@tamagui/stacks";
import {SiteDocumentPayload} from "./loaders";
import {PageFooter} from "./page-footer";
import {SiteHeader} from "./page-header";

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
  const latest = newsQuery.results
    ? [...newsQuery.results].sort(lastUpdateSort)
    : [];
  const firstItem = latest[0];
  const restItems = latest.slice(1);

  return (
    <>
      <YStack marginBottom={300}>
        <SiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docMetadata={document.metadata}
          docId={id}
          breadcrumbs={props.breadcrumbs}
          supportQueries={supportQueries}
        />
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
          <XStack flexWrap="wrap" marginTop="$4" justifyContent="space-between">
            {restItems.map((item) => {
              return (
                <NewspaperCard
                  item={item}
                  entity={getEntity(item.path)}
                  key={item.path.join("/")}
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

function lastUpdateSort(
  a: {updateTime?: PlainMessage<Timestamp>},
  b: {updateTime?: PlainMessage<Timestamp>}
) {
  return lastUpdateOfEntry(b) - lastUpdateOfEntry(a);
}

function lastUpdateOfEntry(entry: {updateTime?: PlainMessage<Timestamp>}) {
  return entry.updateTime?.seconds ? Number(entry.updateTime?.seconds) : 0;
}
