"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
/**
 * This script helps record new performance scenarios using Playwright Inspector.
 * Run it with: PWDEBUG=1 ts-node record-scenario.ts
 */
async function main() {
    console.log("🎥 Starting Scenario Recorder");
    console.log("============================");
    // Start the app
    const { appWindow } = await (0, utils_1.startApp)();
    // This will pause execution and open Playwright Inspector
    // You can now record your actions and copy the generated code
    await appWindow.pause();
    // The code will continue here after you close the inspector
    console.log("\n✨ Recording complete!");
    console.log("Copy the generated code from the Playwright Inspector");
    console.log("and paste it into your scenario's setup function in scenarios.ts");
}
// Run the recorder
main().catch((error) => {
    console.error("Error running scenario recorder:", error);
    process.exit(1);
});
