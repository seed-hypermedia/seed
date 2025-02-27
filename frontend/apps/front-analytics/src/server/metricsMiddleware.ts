import fs from "fs";
import path from "path";
import type {Connect} from "vite";

export function setupMetricsMiddleware(middleware: Connect.Server) {
  middleware.use("/metrics", (req, res, next) => {
    // Handle listing metrics files
    if (req.url === "/") {
      const metricsDir = path.join(process.cwd(), "public", "metrics");

      try {
        const files = fs
          .readdirSync(metricsDir)
          .filter(
            (file) => file.startsWith("results-") && file.endsWith(".log")
          )
          .sort()
          .reverse(); // Most recent first

        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(files));
      } catch (error) {
        console.error("Error reading metrics directory:", error);
        res.end(JSON.stringify([]));
      }
      return;
    }

    // Handle serving individual files
    const filename = req.url?.slice(1); // Remove leading slash
    if (filename) {
      const filePath = path.join(process.cwd(), "public", "metrics", filename);

      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          res.setHeader("Content-Type", "text/plain");
          res.end(content);
        } else {
          res.statusCode = 404;
          res.end("File not found");
        }
      } catch (error) {
        console.error("Error reading metrics file:", error);
        res.statusCode = 500;
        res.end("Error reading file");
      }
      return;
    }

    next();
  });
}
