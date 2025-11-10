const args = process.argv.slice(2);
const channelArg = args.find((arg) => arg.startsWith("--channel="));
const CHANNEL = channelArg ? channelArg.split("=")[1] : "stable";
const versionArg = args.find((arg) => arg.startsWith("--version="));
const VERSION_OVERRIDE = versionArg ? versionArg.split("=")[1] : null;

if (!["dev", "stable"].includes(CHANNEL)) {
  console.error(`Invalid channel: ${CHANNEL}. Must be 'dev' or 'stable'`);
  process.exit(1);
}

const BASE_URL = `https://seedreleases.s3.amazonaws.com/${CHANNEL}/latest`;

async function fetchLatestRelease() {
  const response = await fetch(
    "https://api.github.com/repos/seed-hypermedia/seed/releases/latest",
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        // Add your GitHub token as an environment variable for higher rate limits
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
        }),
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch latest release: ${response.statusText}`);
  }

  return response.json();
}

function transformRelease(release, channel) {
  const assets = release.assets;
  const version = VERSION_OVERRIDE || release.tag_name;
  const isDev = channel === "dev";
  const appPrefix = isDev ? "SeedDev" : "Seed";
  const setupSuffix = isDev ? "-dev" : "";

  const transformed = {
    name: release.name,
    tag_name: version,
    release_notes: release.body,
    assets: {
      macos: {
        x64: {
          download_url: `${BASE_URL}/${appPrefix}-${version}-x64.dmg`,
          zip_url: `${BASE_URL}/${appPrefix}-darwin-x64-${version}.zip`,
        },
        arm64: {
          download_url: `${BASE_URL}/${appPrefix}-${version}-arm64.dmg`,
          zip_url: `${BASE_URL}/${appPrefix}-darwin-arm64-${version}.zip`,
        },
      },
      win32: {
        x64: {
          download_url: `${BASE_URL}/seed${setupSuffix}-${version}-win32-x64-setup.exe`,
          nupkg_url: `${BASE_URL}/seed${setupSuffix}-${version}-full.nupkg`,
          release_url: `${BASE_URL}/RELEASES`,
        },
      },
      linux: {
        rpm: {
          download_url: `${BASE_URL}/seed${setupSuffix}-${version}-1.x86_64.rpm`,
        },
        deb: {
          download_url: `${BASE_URL}/seed${setupSuffix}_${version}_amd64.deb`,
        },
        app_image: {
          download_url: `${BASE_URL}/${appPrefix}-${version}-x64.AppImage`,
        },
        flatpak: {
          download_url: `${BASE_URL}/com.seed.app${isDev ? ".dev" : ""}_stable_x86_64.flatpak`,
        },
      },
    },
  };

  return transformed;
}

async function main() {
  try {
    // If version override provided, we can generate without fetching GitHub
    if (VERSION_OVERRIDE) {
      const transformed = {
        name: `Release ${VERSION_OVERRIDE}`,
        tag_name: VERSION_OVERRIDE,
        release_notes: `${CHANNEL} release ${VERSION_OVERRIDE}`,
        assets: transformRelease({ assets: [], tag_name: VERSION_OVERRIDE, name: "", body: "" }, CHANNEL).assets,
      };
      console.log(JSON.stringify(transformed, null, 2));
    } else {
      const release = await fetchLatestRelease();
      const transformed = transformRelease(release, CHANNEL);
      console.log(JSON.stringify(transformed, null, 2));
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
