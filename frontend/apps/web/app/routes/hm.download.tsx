import {useLoaderData} from "@remix-run/react";
import {hmId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Download} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {Heading, SizableText} from "@tamagui/text";
import {useEffect, useState} from "react";
import {z} from "zod";
import {useFullRender} from "~/cache-policy";
import {loadSiteDocument, SiteDocumentPayload} from "~/loaders";
import {defaultPageMeta} from "~/meta";
import {PageFooter} from "~/page-footer";
import {WebSiteHeader} from "~/page-header";
import {WebSiteProvider} from "~/providers";
import {parseRequest} from "~/request";
import {getConfig} from "~/site-config";
import {unwrap} from "~/wrapping";
import {Container} from "../ui/container";

async function isArm64(): Promise<boolean | null> {
  // this check only works on chrome, not safari. So we need to handle null and offer both dl buttons

  // @ts-expect-error
  const values = await navigator.userAgentData?.getHighEntropyValues([
    "architecture",
  ]);
  if (!values) return null;
  return values.architecture === "arm";
}

function getOS(): undefined | "mac" | "windows" | "linux" {
  const platform = navigator?.platform?.toLowerCase();
  if (!platform) return undefined;
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";

  return undefined;
}

async function getPlatform() {
  return {
    os: getOS(),
    isArm64: await isArm64(),
  };
}

const RELEASES_JSON_URL =
  "https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json";

const assetSchema = z.object({
  download_url: z.string(),
  zip_url: z.string().optional(),
});
const releaseSchema = z.object({
  name: z.string(),
  tag_name: z.string(),
  release_notes: z.string(),
  assets: z.object({
    macos: z
      .object({
        x64: assetSchema.optional(),
        arm64: assetSchema.optional(),
      })
      .optional(),
    win32: z
      .object({
        x64: assetSchema.optional(),
      })
      .optional(),
    linux: z
      .object({
        rpm: assetSchema.optional(),
        deb: assetSchema.optional(),
      })
      .optional(),
  }),
});

async function loadStableRelease() {
  const response = await fetch(RELEASES_JSON_URL);
  const data = await response.json();
  return releaseSchema.parse(data);
}

export const loader = async ({request}: {request: Request}) => {
  const parsedRequest = parseRequest(request);
  if (!useFullRender(parsedRequest)) return null;
  const {hostname} = parsedRequest;
  const serviceConfig = await getConfig(hostname);
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`);
  const {registeredAccountUid} = serviceConfig;
  if (!registeredAccountUid)
    throw new Error(`No registered account uid defined for ${hostname}`);
  const result = await loadSiteDocument(
    hostname,
    hmId("d", registeredAccountUid, {path: [], latest: true}),
    false,
    {
      stableRelease: await loadStableRelease(),
    }
  );
  return result;
};

export const meta = defaultPageMeta("Download Seed Hypermedia");

export default function DownloadPage() {
  const data = unwrap<
    SiteDocumentPayload & {stableRelease: z.infer<typeof releaseSchema>}
  >(useLoaderData());
  const {
    stableRelease,
    homeId,
    homeMetadata,
    id,
    document,
    supportDocuments,
    supportQueries,
  } = data;
  //   const os = getOS();
  const [platform, setPlatform] = useState<
    Awaited<ReturnType<typeof getPlatform>> | undefined
  >(undefined);
  useEffect(() => {
    getPlatform().then(setPlatform);
  }, []);
  const suggestedButtons: React.ReactNode[] = [];
  if (platform?.os === "mac") {
    if (platform.isArm64 || platform.isArm64 == null) {
      suggestedButtons.push(
        <ReleaseEntry
          large
          label="Download Seed for Mac (Apple Silicon)"
          asset={stableRelease.assets?.macos?.arm64}
        />
      );
    }
    if (!platform.isArm64) {
      suggestedButtons.push(
        <ReleaseEntry
          large
          label="Download Seed for Mac (Intel)"
          asset={stableRelease.assets?.macos?.x64}
        />
      );
    }
  } else if (platform?.os === "windows") {
    suggestedButtons.push(
      <ReleaseEntry
        large
        label="Download Seed for Windows x64"
        asset={stableRelease.assets?.win32?.x64}
      />
    );
  } else if (platform?.os === "linux") {
    suggestedButtons.push(
      <ReleaseEntry
        large
        label="Download Seed for Linux (rpm)"
        asset={stableRelease.assets?.linux?.rpm}
      />,
      <ReleaseEntry
        large
        label="Download Seed for Linux (deb)"
        asset={stableRelease.assets?.linux?.deb}
      />
    );
  }
  return (
    <WebSiteProvider homeId={homeId}>
      <YStack>
        <WebSiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
        >
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
                  Download Seed Hypermedia {stableRelease.name}
                </SizableText>
              </XStack>
              <YStack gap="$4">
                {suggestedButtons.length > 0 && (
                  <YStack
                    gap="$2"
                    padding="$4"
                    backgroundColor="$brand10"
                    borderRadius="$4"
                  >
                    <XStack gap="$2" flexWrap="wrap">
                      {suggestedButtons}
                    </XStack>
                  </YStack>
                )}
                <Heading size="$2">All Platforms</Heading>
                {stableRelease.assets?.macos && (
                  <ReleaseSection label="MacOS">
                    <ReleaseEntry
                      label="Intel"
                      asset={stableRelease.assets?.macos?.x64}
                    />
                    <ReleaseEntry
                      label="Apple Silicon"
                      asset={stableRelease.assets?.macos?.arm64}
                    />
                  </ReleaseSection>
                )}
                {stableRelease.assets?.win32 && (
                  <ReleaseSection label="Windows">
                    <ReleaseEntry
                      label="x64"
                      asset={stableRelease.assets?.win32?.x64}
                    />
                  </ReleaseSection>
                )}
                {stableRelease.assets?.linux && (
                  <ReleaseSection label="Linux">
                    <ReleaseEntry
                      label="rpm"
                      asset={stableRelease.assets?.linux?.rpm}
                    />
                    <ReleaseEntry
                      label="deb"
                      asset={stableRelease.assets?.linux?.deb}
                    />
                  </ReleaseSection>
                )}
              </YStack>
            </YStack>
          </Container>
        </WebSiteHeader>
        <PageFooter />
      </YStack>
    </WebSiteProvider>
  );
}

function ReleaseSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <YStack gap="$2">
      <Heading size="$3">{label}</Heading>
      <XStack gap="$2">{children}</XStack>
    </YStack>
  );
}

function ReleaseEntry({
  label,
  asset,
  large,
}: {
  label: string;
  asset?: z.infer<typeof assetSchema>;
  large?: boolean;
}) {
  if (!asset) return null;
  return (
    <Button
      tag="a"
      href={asset.download_url}
      style={{textDecoration: "none"}}
      download
      icon={Download}
      size={large ? "$6" : "$4"}
    >
      {label}
    </Button>
  );
}
