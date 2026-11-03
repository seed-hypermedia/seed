---
path: design/article
title: Design inventory
---
An editorial baseline for the pieces, patterns, and decisions that make a product feel coherent.

## A shared visual language

This guide follows the small decisions that add up: **clear hierarchy**, *quiet emphasis*, and links to [the component catalogue](https://example.com/components) alongside `tokens that stay readable`.

### Start with the content

Good interfaces make the next action obvious without making every action loud. Keep labels specific, give long-form writing room to breathe, and use a restrained accent to make the important state easy to find.

- Use meaningful names for navigation and controls.
- Keep related information together, with enough space to scan.
- Let the content—not decoration—set the rhythm.

1. Establish the page hierarchy.
2. Check contrast in both themes.
3. Confirm the mobile layout still feels intentional.

> A useful design system is a shared vocabulary, not a collection of exceptions.

```tsx
function Surface({children}: {children: React.ReactNode}) {
  return <main className="surface">{children}</main>
}
```

![A small mark from the Seed interface](./design-image.png)

For a deeper look at the related reference, open [the design reference](hm://{{ACCOUNT_ID}}/design/reference).

## Notes in context

The live collection below keeps related research close to the article.

<!-- id:article-notes-query type:Query attrs:{"query":{"includes":[{"space":"{{ACCOUNT_ID}}","path":"design/notes","mode":"Children"}],"sort":[{"term":"UpdateTime","reverse":false}]},"style":"List","columnCount":3,"banner":false} -->
