# Design scorecard

A fixed rubric for scoring a Seed screen. It is used for the Phase 0 baseline, re-run at the end of every phase and each
quarter, and by the `seed-ui-review` skill on UI PRs. The criteria and anchors don't change between runs, so scores stay
comparable. If the rubric itself changes, record the change in the design-system changelog and re-score the baseline.

## How to score

- Score one **view** at a time (one screen in one state), from the `design:capture` screenshots in light and dark,
  desktop and mobile. Use the live app only to check states a screenshot can't show (hover, press, focus, motion).
- Give each criterion a whole number from 0 to 10 using the anchors below. Write one line of evidence for every score
  below 8, naming what you saw ("three different text greys in the sidebar header").
- The view's score is the plain mean of the eight criteria, rounded to one decimal. A surface's score is the mean of its
  views.
- Compare against the reference products (Linear for chrome and density, Anytype for calm object views). A 10 means "as
  good as the best of them on this criterion", not "perfect".
- Score what ships. A known bug counts against the view until it's fixed.

## Anchors

Each criterion has three anchors. 2 = clearly broken, 5 = works but generic or inconsistent, 8 = deliberate and
consistent, with small slips at most. 10 = reference quality. Odd scores sit between the anchors.

### 1. Hierarchy

What matters most is obvious at a glance, and the eye moves in the intended order.

- 2: Everything has the same weight, or the main action and content are hard to find.
- 5: The main element is findable, but secondary items compete (badges, colour or borders used for emphasis everywhere).
- 8: One clear focal point. Emphasis comes from position, weight and contrast before containers or colour.
- 10: Nothing could be removed or demoted without losing meaning (passes the anti-slop removal test).

### 2. Alignment and rhythm

Edges, columns and spacing follow a system.

- 2: Visibly misaligned edges and icons, random gaps.
- 5: Mostly aligned, but spacing values vary without reason and headers or rows differ in height between areas.
- 8: Shared columns for icons and labels, spacing from the scale, consistent header and row heights across panels.
- 10: Alignment holds across panels, breakpoints and RTL. Optical corrections are made where needed (icons, round
  shapes).

### 3. Typography

Type roles, sizes, weights and line length.

- 2: Many ad-hoc sizes and weights, poor line length, clipped or overflowing text.
- 5: Readable, but more sizes than roles, weights doing the work of hierarchy, and inconsistent tracking.
- 8: A small set of roles used consistently, tabular numbers where numbers line up, a reading measure around 65ch.
- 10: Type alone carries the hierarchy, and long, short and non-Latin text all hold up.

### 4. Colour and material

Surfaces, text greys, borders, shadows and accent use.

- 2: Raw palette colours, clashing greys, heavy shadows, or contrast failures.
- 5: Tokens are mostly used, but there are too many greys and borders, the accent is used for decoration, and dark mode
  is an inversion.
- 8: Semantic surfaces and text levels, the accent only for action or brand, status colours only for meaning, and dark
  mode designed on its own terms.
- 10: Calm and coherent in every theme, depth from layered low-opacity shadows or rings, nothing reads as a default
  shadcn colour.

### 5. States

Hover, pressed, focus-visible, disabled, loading, selected, empty, error, success, and labels that match the state.

- 2: Missing states (no focus ring, no loading or empty state), or labels that contradict the state.
- 5: States exist but are browser or library defaults and inconsistent between components.
- 8: Every meaningful state is designed and consistent, empty and error states explain what to do next, and labels
  always match the current state.
- 10: States feel tactile and trustworthy. Worst-case data (long names, zero or huge counts, offline) is handled
  gracefully.

### 6. Motion

Whether things move, how, and how often.

- 2: Janky or layout-shifting animation, `transition-all`, animation on high-frequency or keyboard actions, or no
  reduced-motion path.
- 5: Default easings and durations, fade-only entrances, motion that adds nothing.
- 8: Motion only where it explains a change, ease-out from motion tokens, under 300ms, scales from its trigger, respects
  reduced motion.
- 10: Interruptible, physically plausible (springs and momentum where gestures are involved), and invisible when it
  should be.

### 7. Density

How much useful information fits without crowding.

- 2: Cramped and overlapping, or so sparse that a common task needs scrolling.
- 5: Generic web spacing, large paddings and cards around everything, low information per screen.
- 8: Tight but calm, like Linear: compact rows, quiet metadata, chrome that takes little space.
- 10: Density adapts to the task (scan vs. read) and the screen stays calm at the busiest realistic data.

### 8. Accessibility

What a user with a disability experiences, beyond the automated gates.

- 2: Axe violations, keyboard traps, unreadable contrast, or targets under 24px.
- 5: The gates pass, but focus order is odd, landmarks or names are vague, or the view breaks at 200% zoom or 320px
  reflow.
- 8: Logical focus order, visible focus, clear accessible names, works at 400% zoom, in forced colours and with a screen
  reader.
- 10: The accessible path is as fast and pleasant as the default one (keyboard-first, good announcements, no surprises).

## Record format

One table per run, stored with the journal entry for that phase:

| View            | Hier. | Align. | Type | Colour | States | Motion | Density | A11y | Score | Evidence (scores below 8) |
| --------------- | ----- | ------ | ---- | ------ | ------ | ------ | ------- | ---- | ----- | ------------------------- |
| desktop/library |       |        |      |        |        |        |         |      |       |                           |

Record the commit SHA, the date, who scored, and the capture directory for each run.
