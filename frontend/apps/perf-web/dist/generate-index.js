import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function generateIndexFiles() {
    const resultsDir = path.join(__dirname, "..", "results");
    const apps = ["web", "landing"];
    for (const app of apps) {
        const appDir = path.join(resultsDir, app);
        // Skip if app directory doesn't exist
        if (!fs.existsSync(appDir)) {
            console.log(`No results directory for ${app}`);
            continue;
        }
        // Read all JSON files in the app directory
        const files = await fs.readdir(appDir);
        const jsonFiles = files.filter((file) => file.endsWith(".json"));
        // Read and sort results by date (newest first)
        const results = await Promise.all(jsonFiles.map(async (file) => {
            const filePath = path.join(appDir, file);
            const content = await fs.readJson(filePath);
            return content;
        }));
        // Sort by timestamp, newest first
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        // Write index file
        const indexPath = path.join(appDir, "index.json");
        await fs.writeJson(indexPath, results, { spaces: 2 });
        console.log(`Generated index for ${app} with ${results.length} results`);
    }
}
generateIndexFiles().catch((error) => {
    console.error("Error generating index files:", error);
    process.exit(1);
});
