import {execSync} from "child_process";

const args = process.argv.slice(2);
const DEBUG = args.includes("--debug") || false;

async function getLatestProdVersion() {
  try {
    // Get all tags and sort them to find the latest one
    const tags = execSync(
      'git fetch --tags && git tag --list "[0-9][0-9][0-9][0-9].[0-9]*.[0-9]*"'
    )
      .toString()
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => {
        const [aYear, aMonth, aNum] = a.split(".");
        const [bYear, bMonth, bNum] = b.split(".");
        if (aYear !== bYear) return bYear - aYear;
        if (aMonth !== bMonth) return bMonth - aMonth;
        return bNum - aNum;
      });

    // console.log("Available production versions:", tags);
    // console.log("Latest production version:", tags[0]);
    return tags[0]; // Latest version
  } catch (error) {
    console.error("Error getting production version:", error);
    process.exit(1);
  }
}

async function getLatestDevVersion() {
  try {
    // console.log("Fetching dev version from S3...");
    const response = await fetch(
      "https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest/RELEASES.json"
    );
    const data = await response.json();
    if (DEBUG) {
      console.log("Current dev version from S3:", data.currentRelease);
    }
    return data.currentRelease;
  } catch (error) {
    console.error("Error fetching dev version:", error);
    return null;
  }
}

async function generateNextVersion() {
  const prodVersion = await getLatestProdVersion();
  const devVersion = await getLatestDevVersion();

  if (DEBUG) {
    console.log("\nCalculating next version:");
    console.log("- Production version:", prodVersion);
    console.log("- Current dev version:", devVersion);
  }

  if (!devVersion || !devVersion.startsWith(prodVersion)) {
    // If no dev version exists or it doesn't match current prod version,
    // create first dev version
    const newVersion = `${prodVersion}-dev.1`;
    // console.log("- Next dev version:", newVersion);
    return newVersion;
  }

  // Extract and increment the dev number
  const match = devVersion.match(/-dev\.(\d+)$/);
  if (match) {
    const currentNum = parseInt(match[1], 10);
    const newVersion = `${prodVersion}-dev.${currentNum + 1}`;
    // console.log("- Incrementing dev version:", newVersion);
    return newVersion;
  }

  // Fallback to first dev version if pattern doesn't match
  const fallbackVersion = `${prodVersion}-dev.1`;
  // console.log("- Falling back to first dev version:", fallbackVersion);
  return fallbackVersion;
}

// Execute and output the version
generateNextVersion()
  .then((version) => {
    if (DEBUG) {
      console.log("\nFinal version:", version);
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
