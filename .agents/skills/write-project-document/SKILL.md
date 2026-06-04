---
name: write-project-document
description: Create concise project documents in Markdown with the sections Problem, Solution, Scope, Rabbit Holes, and No Gos. Use when the user asks to draft, structure, or refine a project document, project brief, proposal, feature spec, or planning note in this specific Seed-style format.
---

# Write Project Document

Create comprehensive project document in Markdown with the sections Problem, Solution, Scope, Rabbit Holes, and No Gos based on the current context, draft, solution and scope in this specific session. write the document in the `./docs/projects/` folder (create the folder if not present).

<support-material>

## Output format

Always produce these sections in this order:

```markdown
# <Project title>

## Problem

## Solution

## Scope

## Rabbit Holes

## No Gos
```

Use bullets when the content is easier to scan. Use paragraphs only where narrative explanation is clearer.

## Section guidance

- **Problem**: State the user pain, product gap, or operational issue. Explain why it matters now. Avoid solution details unless needed for context.
- **Solution**: Describe the proposed approach in concrete terms. Include the user-facing behavior and the system changes only at the level needed for planning. Define what will be included. Prefer crisp bullets that can later become implementation tasks or acceptance criteria. if you can also add user stories to it the better.
- **Scope**: the timeframe it will require to implement the solution. if the plan is multi-phase or multi-step, you can define the timeframe for each one and also dependencies of each phase/section
- **Rabbit Holes**: List tempting investigations, extensions, or refactors that could consume time but are not required for the first useful version.
- **No Gos**: List explicit non-goals, constraints, and things the project should not do.

## Working style

If inputs are sparse, draft a useful first version with clearly labeled assumptions instead of blocking. Ask clarifying questions only when a missing decision would materially change the project direction.

Keep the document practical and opinionated. Favor specific statements over generic product-planning language.

</support-material>