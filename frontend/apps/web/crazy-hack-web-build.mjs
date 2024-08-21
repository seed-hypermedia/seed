import {execFileSync, spawn} from "child_process";
import {dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function attemptBuild() {
  console.log("Starting Attempted Build");
  execFileSync("yarn", ["build"], {cwd: __dirname, stdio: "inherit"});
  console.log("Build Complete. Testing...");
  const testServer = spawn("yarn", ["start"], {
    cwd: __dirname,
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    // wait for server to be ready to serve
    setTimeout(resolve, 2_000);
  });
  let didPass = false;
  await fetch("http://localhost:3000/")
    .then((res) => {
      if (res.ok) {
        console.log("Server is running successfully");
        didPass = true;
      } else {
        console.error("Server is not running successfully", e);
      }
    })
    .catch((e) => {
      console.error("Test server fetch failed", e);
    });
  testServer.kill();
  return didPass;
}

async function main() {
  let attempts = 0;
  let passed = false;
  while (!passed) {
    passed = await attemptBuild();
    attempts += 1;
    if (!passed && attempts >= 15) {
      throw new Error("Failed to build after 15 attempts");
    }
    if (!passed) {
      console.log(`Attempt ${attempts} failed. Retrying...`);
    }
  }
  return attempts;
}

main()
  .then((attemptCount) => {
    console.log(`CrazyHackWebBuild Success after ${attemptCount} attempts`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
