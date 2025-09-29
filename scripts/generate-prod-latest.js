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

function transformRelease(release) {
  const assets = release.assets;
  const transformed = {
    name: release.name,
    tag_name: release.tag_name,
    release_notes: release.body,
    assets: {
      macos: {
        x64: {
          download_url: assets.find((a) => a.name.includes("-x64.dmg"))
            ?.browser_download_url,
          zip_url: assets.find((a) => a.name.includes("darwin-x64"))
            ?.browser_download_url,
        },
        arm64: {
          download_url: assets.find((a) => a.name.includes("-arm64.dmg"))
            ?.browser_download_url,
          zip_url: assets.find((a) => a.name.includes("darwin-arm64"))
            ?.browser_download_url,
        },
      },
      win32: {
        x64: {
          download_url: assets.find((a) =>
            a.name.includes("win32-x64-setup.exe")
          )?.browser_download_url,
          nupkg_url: assets.find((a) => a.name.includes("-full.nupkg"))
            ?.browser_download_url,
          release_url: assets.find((a) => a.name == "RELEASES")
            ?.browser_download_url,
        },
      },
      linux: {
        rpm: {
          download_url: assets.find((a) => a.name.includes(".rpm"))
            ?.browser_download_url,
        },
        deb: {
          download_url: assets.find((a) => a.name.includes(".deb"))
            ?.browser_download_url,
        },
        app_image: {
          download_url: assets.find((a) => a.name.includes(".AppImage"))
            ?.browser_download_url,
        },
        flatpak: {
          download_url: assets.find((a) => a.name.includes(".flatpak"))
            ?.browser_download_url,
        },
      },
    },
  };

  return transformed;
}

async function main() {
  try {
    const release = await fetchLatestRelease();
    const transformed = transformRelease(release);
    console.log(JSON.stringify(transformed, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
