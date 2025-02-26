
find . -type d -name "node_modules" -exec rm -r {} \; 2>/dev/null || true 
find . -type d -name ".tamagui" -exec rm -r {} \; 2>/dev/null || true 
rm -f frontend/packages/ui/src/themes-generated.ts
rm -f yarn.lock
rm -rf frontend/apps/desktop/.vite
