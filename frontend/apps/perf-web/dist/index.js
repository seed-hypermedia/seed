import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { budgets } from "./config.js";
import { runLighthouseTest } from "./lighthouse.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option("url", {
        type: "string",
        description: "URL to test",
        required: true,
    })
        .option("app", {
        type: "string",
        choices: ["web", "landing"],
        description: "App to test",
        required: true,
    })
        .parse();
    const appBudgets = budgets[argv.app];
    const violations = [];
    console.log(`Running performance tests for ${argv.app} at ${argv.url}`);
    // Run mobile tests
    console.log("\nRunning mobile tests...");
    const mobileMetrics = await runLighthouseTest(argv.url, true);
    // Check mobile budgets
    Object.entries(mobileMetrics).forEach(([metric, value]) => {
        const budget = appBudgets.mobile[metric];
        if (budget && value > budget) {
            violations.push({
                metric: metric,
                actual: value,
                limit: budget,
                device: "mobile",
            });
        }
    });
    // Run desktop tests
    console.log("\nRunning desktop tests...");
    const desktopMetrics = await runLighthouseTest(argv.url, false);
    // Check desktop budgets
    Object.entries(desktopMetrics).forEach(([metric, value]) => {
        const budget = appBudgets.desktop[metric];
        if (budget && value > budget) {
            violations.push({
                metric: metric,
                actual: value,
                limit: budget,
                device: "desktop",
            });
        }
    });
    // Prepare results
    const result = {
        timestamp: new Date().toISOString(),
        app: argv.app,
        commit: process.env.GITHUB_SHA || "local",
        branch: process.env.GITHUB_REF || "local",
        mobile: mobileMetrics,
        desktop: desktopMetrics,
        budgetViolations: violations,
    };
    // Save results
    const resultsDir = path.join(__dirname, "..", "results", argv.app);
    await fs.ensureDir(resultsDir);
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await fs.writeJson(path.join(resultsDir, fileName), result, { spaces: 2 });
    // Output results
    console.log("\nResults:");
    console.log("Mobile Metrics:", mobileMetrics);
    console.log("Desktop Metrics:", desktopMetrics);
    if (violations.length > 0) {
        console.error("\nPerformance budget violations:");
        violations.forEach((v) => {
            console.error(`- ${v.device} ${v.metric}: ${v.actual} (limit: ${v.limit})`);
        });
        process.exit(1);
    }
    else {
        console.log("\nAll performance budgets passed! ✨");
    }
}
main().catch((error) => {
    console.error("Error running performance tests:", error);
    process.exit(1);
});
