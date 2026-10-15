#!/bin/sh
# Print the first worktree containing the requested file, preferring the main worktree.
git worktree list --porcelain | while IFS= read -r line; do
  case "$line" in
    'worktree '*)
      worktree=${line#worktree }
      if [ -f "$worktree/$1" ]; then
        printf '%s\n' "$worktree"
        break
      fi
      ;;
  esac
done
