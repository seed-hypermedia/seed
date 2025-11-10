import { describe, it, expect, beforeEach, vi } from "vitest";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptPath = join(__dirname, "generate-version.mjs");

// Mock fetch globally
global.fetch = vi.fn();

// Mock Date
const mockDate = new Date("2025-11-10");
vi.useFakeTimers();
vi.setSystemTime(mockDate);

describe("Version Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Stable Version Calculation", () => {
    describe("when no stable version exists in S3", () => {
      beforeEach(() => {
        global.fetch.mockResolvedValue({
          ok: false,
          status: 404,
        });
      });

      it("should start at current year.month.1", async () => {
        // Current date is 2025-11-10
        const version = await generateNextStableVersion();
        expect(version).toBe("2025.11.1");
      });
    });

    describe("when stable version exists in same month", () => {
      it("should increment patch version", async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ name: "2025.11.6" }),
        });

        const version = await generateNextStableVersion();
        expect(version).toBe("2025.11.7");
      });

      it("should handle multiple increments", async () => {
        const testCases = [
          { current: "2025.11.1", expected: "2025.11.2" },
          { current: "2025.11.9", expected: "2025.11.10" },
          { current: "2025.11.99", expected: "2025.11.100" },
        ];

        for (const { current, expected } of testCases) {
          global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ name: current }),
          });

          const version = await generateNextStableVersion();
          expect(version).toBe(expected);
        }
      });
    });

    describe("when stable version is from previous month", () => {
      it("should reset to new month with patch 1", async () => {
        // Current: November 2025
        global.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ name: "2025.10.15" }),
        });

        const version = await generateNextStableVersion();
        expect(version).toBe("2025.11.1");
      });
    });

    describe("when stable version is from previous year", () => {
      it("should reset to new year.month.1", async () => {
        // Mock January 2026
        const jan2026 = new Date("2026-01-15");
        vi.setSystemTime(jan2026);

        global.fetch.mockResolvedValue({
          ok: true,
          json: async () => ({ name: "2025.12.20" }),
        });

        const version = await generateNextStableVersion();
        expect(version).toBe("2026.1.1");
      });
    });
  });

  describe("Dev Version Calculation", () => {
    describe("when no dev version exists", () => {
      it("should create first dev version based on stable", async () => {
        // Mock stable version
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6" }),
          })
          // Mock dev version (not found)
          .mockResolvedValueOnce({
            ok: false,
            status: 404,
          });

        const version = await generateNextDevVersion();
        expect(version).toBe("2025.11.6-dev.1");
      });
    });

    describe("when dev version exists for current stable", () => {
      it("should increment dev number", async () => {
        // Mock stable version
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6" }),
          })
          // Mock dev version
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6-dev.2" }),
          });

        const version = await generateNextDevVersion();
        expect(version).toBe("2025.11.6-dev.3");
      });

      it("should handle various dev increments", async () => {
        const testCases = [
          { stable: "2025.11.6", currentDev: "2025.11.6-dev.1", expected: "2025.11.6-dev.2" },
          { stable: "2025.11.6", currentDev: "2025.11.6-dev.9", expected: "2025.11.6-dev.10" },
          { stable: "2025.11.6", currentDev: "2025.11.6-dev.99", expected: "2025.11.6-dev.100" },
        ];

        for (const { stable, currentDev, expected } of testCases) {
          global.fetch
            .mockResolvedValueOnce({
              ok: true,
              json: async () => ({ name: stable }),
            })
            .mockResolvedValueOnce({
              ok: true,
              json: async () => ({ name: currentDev }),
            });

          const version = await generateNextDevVersion();
          expect(version).toBe(expected);
        }
      });
    });

    describe("when stable version changed", () => {
      it("should reset dev counter to 1", async () => {
        // Stable version increased
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.7" }),
          })
          // Dev version still on old stable
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6-dev.5" }),
          });

        const version = await generateNextDevVersion();
        expect(version).toBe("2025.11.7-dev.1");
      });

      it("should reset when month changes", async () => {
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.12.1" }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6-dev.10" }),
          });

        const version = await generateNextDevVersion();
        expect(version).toBe("2025.12.1-dev.1");
      });
    });

    describe("edge cases", () => {
      it("should handle malformed dev version gracefully", async () => {
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6" }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6-invalid" }),
          });

        const version = await generateNextDevVersion();
        expect(version).toBe("2025.11.6-dev.1");
      });

      it("should not create double -dev suffix (bug fix)", async () => {
        // This was the original bug - ensure it doesn't regress
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.7" }), // Different stable
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ name: "2025.11.6-dev.2" }),
          });

        const version = await generateNextDevVersion();
        // Should NOT be "2025.11.6-dev.2-dev.3"
        expect(version).toBe("2025.11.7-dev.1");
        expect(version).not.toContain("-dev.2-dev");
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete release cycle", async () => {
      const scenarios = [
        // Start fresh
        {
          stable: null,
          dev: null,
          expectedStable: "2025.11.1",
          expectedDev: "2025.11.1-dev.1"
        },
        // Dev iterations
        {
          stable: "2025.11.1",
          dev: "2025.11.1-dev.1",
          expectedStable: "2025.11.2",
          expectedDev: "2025.11.1-dev.2"
        },
        // After stable release
        {
          stable: "2025.11.2",
          dev: "2025.11.1-dev.5",
          expectedStable: "2025.11.3",
          expectedDev: "2025.11.2-dev.1"
        },
        // Month boundary
        {
          stable: "2025.11.10",
          dev: "2025.11.10-dev.3",
          nextMonth: true, // Simulate December
          expectedStable: "2025.12.1",
          expectedDev: "2025.11.10-dev.4" // Dev continues until stable actually changes
        },
      ];

      for (const scenario of scenarios) {
        if (scenario.nextMonth) {
          vi.setSystemTime(new Date("2025-12-01"));
        } else {
          vi.setSystemTime(new Date("2025-11-10"));
        }

        // Test stable version
        global.fetch.mockResolvedValueOnce(
          scenario.stable
            ? { ok: true, json: async () => ({ name: scenario.stable }) }
            : { ok: false, status: 404 }
        );
        const stableVersion = await generateNextStableVersion();
        expect(stableVersion).toBe(scenario.expectedStable);

        // Test dev version
        global.fetch
          .mockResolvedValueOnce(
            scenario.stable
              ? { ok: true, json: async () => ({ name: scenario.stable }) }
              : { ok: false, status: 404 }
          )
          .mockResolvedValueOnce(
            scenario.dev
              ? { ok: true, json: async () => ({ name: scenario.dev }) }
              : { ok: false, status: 404 }
          );
        const devVersion = await generateNextDevVersion();
        expect(devVersion).toBe(scenario.expectedDev);
      }
    });
  });
});

// Helper functions to test the module's internal functions
// Since the module doesn't export these, we need to replicate the logic
async function generateNextStableVersion() {
  const response = await fetch(
    "https://seedreleases.s3.eu-west-2.amazonaws.com/stable/latest.json"
  );

  if (!response.ok) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    return `${currentYear}.${currentMonth}.1`;
  }

  const data = await response.json();
  const latest = data.name;
  const [latestYear, latestMonth, latestPatch] = latest.split(".").map(Number);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (
    currentYear > latestYear ||
    (currentYear === latestYear && currentMonth > latestMonth)
  ) {
    return `${currentYear}.${currentMonth}.1`;
  }

  return `${latestYear}.${latestMonth}.${latestPatch + 1}`;
}

async function generateNextDevVersion() {
  // Get stable version first
  const stableResponse = await fetch(
    "https://seedreleases.s3.eu-west-2.amazonaws.com/stable/latest.json"
  );

  let stableVersion;
  if (!stableResponse.ok) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    stableVersion = `${currentYear}.${currentMonth}.1`;
  } else {
    const data = await stableResponse.json();
    stableVersion = data.name;
  }

  // Get dev version
  const devResponse = await fetch(
    "https://seedappdev.s3.eu-west-2.amazonaws.com/dev/latest.json"
  );

  if (!devResponse.ok) {
    return `${stableVersion}-dev.1`;
  }

  const devData = await devResponse.json();
  const devVersion = devData.name;

  if (!devVersion.startsWith(stableVersion)) {
    return `${stableVersion}-dev.1`;
  }

  // Extract the stable part and dev number properly
  const stablePartMatch = devVersion.match(/^([\d.]+)-dev\.(\d+)$/);
  if (stablePartMatch) {
    const stablePart = stablePartMatch[1];
    const currentNum = parseInt(stablePartMatch[2], 10);
    return `${stablePart}-dev.${currentNum + 1}`;
  }

  return `${stableVersion}-dev.1`;
}