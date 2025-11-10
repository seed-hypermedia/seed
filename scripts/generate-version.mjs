import {execSync} from "child_process";

const args = process.argv.slice(2);
const DEBUG = args.includes("--debug") || false;
const channelArg = args.find((arg) => arg.startsWith("--channel="));
const CHANNEL = channelArg ? channelArg.split("=")[1] : "dev";

if (!["dev", "stable"].includes(CHANNEL)) {
  console.error(`Invalid channel: ${CHANNEL}. Must be 'dev' or 'stable'`);
  process.exit(1);
}

async function getLatestStableVersion() {
  try {
    // Fetch latest stable version from S3
    const response = await fetch(
      "https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json"
    );

    console.log(`== ~ getLatestStableVersion ~ response:`, response.ok);

    if (!response.ok) {
      // No stable version exists yet - start at current month .1
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const firstVersion = `${currentYear}.${currentMonth}.1`;

      if (DEBUG) {
        console.log(
          "No stable version found in S3, starting at:",
          firstVersion
        );
      }
      return firstVersion;
    }

    const data = await response.json();
    if (DEBUG) {
      console.log("Current stable version from S3:", data.name);
    }
    return data.name;
  } catch (error) {
    console.error("Error getting stable version:", error);
    process.exit(1);
  }
}

async function getNextStableVersion() {
  const latest = await getLatestStableVersion();
  const [latestYear, latestMonth, latestPatch] = latest.split(".").map(Number);

  // Get current year and month
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 0-indexed

  if (DEBUG) {
    console.log("Latest stable version:", latest);
    console.log(`Current date: ${currentYear}.${currentMonth}`);
  }

  // Check if we're in a new month/year
  if (
    currentYear > latestYear ||
    (currentYear === latestYear && currentMonth > latestMonth)
  ) {
    // New month/year - reset patch to 1
    const newVersion = `${currentYear}.${currentMonth}.1`;
    if (DEBUG) {
      console.log(`New month/year detected, resetting to: ${newVersion}`);
    }
    return newVersion;
  }

  // Same month - increment patch
  const newVersion = `${latestYear}.${latestMonth}.${latestPatch + 1}`;
  if (DEBUG) {
    console.log(`Same month, incrementing patch to: ${newVersion}`);
  }
  return newVersion;
}

async function getLatestDevVersion() {
  try {
    const response = await fetch(
      "https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json"
    );

    if (!response.ok) {
      if (DEBUG) {
        console.log(
          "No dev version found in S3 (404 expected for first build)"
        );
      }
      return null;
    }

    const data = await response.json();
    if (DEBUG) {
      console.log("Current dev version from S3:", data.name);
    }
    return data.name;
  } catch (error) {
    if (DEBUG) {
      console.log(
        "Error fetching dev version (might not exist yet):",
        error.message
      );
    }
    return null;
  }
}

async function getNextDevVersion() {
  const stableVersion = await getLatestStableVersion();
  const devVersion = await getLatestDevVersion();

  if (DEBUG) {
    console.log("\nCalculating next dev version:");
    console.log("- Latest stable version:", stableVersion);
    console.log("- Current dev version:", devVersion);
  }

  // If no dev version exists OR stable version changed, reset to dev.1
  if (!devVersion || !devVersion.startsWith(stableVersion)) {
    const newVersion = `${stableVersion}-dev.1`;
    if (DEBUG) {
      console.log("- Creating first dev version or resetting:", newVersion);
    }
    return newVersion;
  }

  // Extract the stable part from dev version and the dev number
  const stablePartMatch = devVersion.match(/^([\d.]+)-dev\.(\d+)$/);
  if (stablePartMatch) {
    const stablePart = stablePartMatch[1];
    const currentNum = parseInt(stablePartMatch[2], 10);
    const newVersion = `${stablePart}-dev.${currentNum + 1}`;
    if (DEBUG) {
      console.log("- Incrementing dev version:", newVersion);
    }
    return newVersion;
  }

  // Fallback to first dev version if pattern doesn't match
  const fallbackVersion = `${stableVersion}-dev.1`;
  if (DEBUG) {
    console.log("- Falling back to first dev version:", fallbackVersion);
  }
  return fallbackVersion;
}

async function generateVersion() {
  if (DEBUG) {
    console.log(`\n=== Generating version for channel: ${CHANNEL} ===\n`);
  }

  if (CHANNEL === "stable") {
    return await getNextStableVersion();
  } else if (CHANNEL === "dev") {
    return await getNextDevVersion();
  }
}

// Execute and output the version
generateVersion()
  .then((version) => {
    if (DEBUG) {
      console.log("\n=== Final version:", version, "===\n");
    } else {
      console.log(version);
    }
    // For GitHub Actions output
    if (process.env.GITHUB_OUTPUT) {
      execSync(`echo "version=${version}" >> $GITHUB_OUTPUT`);
    }
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
