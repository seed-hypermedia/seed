#!/usr/bin/env node

import {existsSync, readFileSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Z-index mapping based on the refactoring plan
const zIndexMappings = {
  // Critical overlays, modals, dropdowns (z-50 - MAXIMUM)
  "z-[99999]": "z-50",
  "z-[200000]": "z-50", // Found in code-block-view.tsx
  "z-[9999]": "z-50",
  "z-[999999]": "z-50", // Found in tooltip.tsx

  // Fixed bottom bars, notifications (z-40)
  "z-[1000]": "z-40",
  "z-[999]": "z-40",
  "z-[900]": "z-40",
  "z-[800]": "z-40",

  // Intermediate layer (z-20 to z-30)
  "z-20": "z-20", // Keep existing z-20

  // Base layer (z-0 to z-10)
  "z-[7]": "z-9", // Resize handle
  "z-[5]": "z-5", // Keep existing z-5
  "z-[4]": "z-3", // Small interactive elements
  "z-[1]": "z-1", // Keep existing z-1
};

// Files to refactor based on the plan
const filesToRefactor = [
  "frontend/packages/ui/src/blocks-content.tsx",
  "frontend/packages/editor/src/hm-link-form.tsx",
  "frontend/packages/editor/src/autocomplete.tsx",
  "frontend/packages/ui/src/site-header.tsx",
  "frontend/apps/desktop/src/components/titlebar-common.tsx",
  "frontend/apps/desktop/src/components/sidebar-base.tsx",
  "frontend/apps/desktop/src/utils/navigation-container.tsx",
  "frontend/packages/editor/src/embed-block.tsx",

  // Additional files found in the codebase search
  "frontend/packages/ui/src/components/popover.tsx",
  "frontend/packages/editor/src/tiptap-extension-code-block/code-block-view.tsx",
  "frontend/packages/editor/src/media-render.tsx",
  "frontend/packages/editor/src/media-container.tsx",
  "frontend/packages/ui/src/document-cover.tsx",
  "frontend/packages/ui/src/components/dialog.tsx",
  "frontend/packages/ui/src/tooltip.tsx",
  "frontend/packages/ui/src/select-dropdown.tsx",
  "frontend/packages/ui/src/hover-card.tsx",
  "frontend/packages/ui/src/resize-handle.tsx",
  "frontend/apps/web/app/document.tsx",
  "frontend/apps/desktop/src/pages/document.tsx",
  "frontend/apps/desktop/src/editor/query-block.tsx",
  "frontend/apps/desktop/src/components/onboarding.tsx",
  "frontend/apps/desktop/src/components/list-item.tsx",
  "frontend/apps/desktop/src/components/titlebar-search.tsx",
  "frontend/apps/desktop/src/components/auto-updater.tsx",
];

function refactorFile(filePath) {
  const fullPath = join(projectRoot, filePath);

  if (!existsSync(fullPath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return false;
  }

  try {
    let content = readFileSync(fullPath, "utf8");
    let changed = false;
    let changeCount = 0;

    // Apply z-index mappings with more precise matching
    for (const [oldZIndex, newZIndex] of Object.entries(zIndexMappings)) {
      // Skip if old and new are the same
      if (oldZIndex === newZIndex) continue;

      // Create regex that matches the z-index class within className attributes
      const escapedOldZIndex = oldZIndex.replace(/[[\]]/g, "\\$&");
      const regex = new RegExp(escapedOldZIndex, "g");
      const matches = content.match(regex);

      if (matches) {
        content = content.replace(regex, newZIndex);
        changeCount += matches.length;
        changed = true;
        console.log(
          `  ✓ Replaced ${matches.length} occurrence(s) of ${oldZIndex} → ${newZIndex}`
        );
      }
    }

    if (changed) {
      writeFileSync(fullPath, content, "utf8");
      console.log(`✅ Updated ${filePath} (${changeCount} changes)`);
      return true;
    } else {
      console.log(`ℹ️  No z-index changes needed in ${filePath}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

function validateZIndexHierarchy() {
  console.log("\n📊 Z-Index Hierarchy Validation:");
  console.log("================================");
  console.log("Base Layer (z-0 to z-10):");
  console.log("  z-0  - Default/base elements");
  console.log("  z-1  - Slight elevation (avatars, cards)");
  console.log("  z-2  - Small interactive elements");
  console.log("  z-3  - Search icons, small overlays");
  console.log("  z-5  - Media overlays, form placeholders");
  console.log("  z-9  - Formatting toolbars");
  console.log("  z-10 - Sidebar elements, navigation helpers");
  console.log("\nIntermediate Layer (z-20 to z-30):");
  console.log("  z-20 - Change items, timeline elements");
  console.log("  z-30 - Search icons in inputs");
  console.log("\nHigh Priority Layer (z-40 to z-50):");
  console.log("  z-40 - Fixed bottom bars, notifications");
  console.log("  z-50 - MAXIMUM - Critical overlays, modals, dropdowns");
}

function main() {
  console.log("🔧 Z-Index Refactoring Script");
  console.log("==============================\n");

  let totalFilesChanged = 0;
  let totalChanges = 0;

  console.log(`📁 Processing ${filesToRefactor.length} files...\n`);

  for (const filePath of filesToRefactor) {
    console.log(`📄 Processing: ${filePath}`);
    const wasChanged = refactorFile(filePath);
    if (wasChanged) {
      totalFilesChanged++;
    }
    console.log(""); // Empty line for readability
  }

  console.log("🎉 Refactoring Complete!");
  console.log("========================");
  console.log(`📊 Files processed: ${filesToRefactor.length}`);
  console.log(`✅ Files changed: ${totalFilesChanged}`);
  console.log(`🔧 Total replacements: ${totalChanges}`);

  validateZIndexHierarchy();

  console.log("\n📋 Next Steps:");
  console.log("==============");
  console.log("1. Review the changes with git diff");
  console.log("2. Test critical interactions:");
  console.log("   - Modal overlays should be on top (z-50)");
  console.log("   - Dropdowns should appear above content (z-50)");
  console.log("   - Tooltips and hover states (z-40)");
  console.log("   - Fixed navigation elements (z-40)");
  console.log("3. Run tests: yarn web:test run");
  console.log("4. Check mobile navigation functionality");
  console.log("5. Verify editor toolbars and menus work properly");

  if (totalFilesChanged === 0) {
    console.log("\n⚠️  No files were changed. This might indicate:");
    console.log("   - All z-index values are already following the plan");
    console.log("   - File paths have changed");
    console.log("   - Z-index patterns are different than expected");
  }
}

// Run the script
main();
