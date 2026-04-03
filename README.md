# BEM Checker

A static, client-side tool for linting BEM naming convention violations in your codebase.

Drop a workspace folder into the page and it scans your CSS/HTML files instantly — no server, no uploads, everything runs in your browser.

## Usage

Open `index.html` in a browser, or deploy it anywhere as a static site. Drop your project folder onto the drop zone, or click **Choose folder**.

Supports `.css`, `.scss`, `.sass`, `.less`, `.html`, and `.htm` files. Skips `node_modules`, `vendor`, and hidden directories.

## What it checks

| Rule | Bad | Good |
|---|---|---|
| Lowercase only | `.Card` | `.card` |
| No orphan elements | `.__element` | `.block__element` |
| No orphan modifiers | `.--modifier` | `.block--modifier` |
| No nested elements | `.block__el__sub` | `.block__el` |
| No element after modifier | `.block--mod__el` | `.block__el--mod` |
| No empty segments | `.block__` | `.block__element` |
| No multiple modifiers | `.block--a--b` | `.block--a` |
| Valid identifiers only | `.1block`, `.block_name` | `.block`, `.my-block` |

A valid name segment must match `[a-z][a-z0-9-]*` — starts with a lowercase letter, followed by lowercase letters, digits, or hyphens.

## Privacy

Files are read locally by the browser and never sent anywhere. No backend, no bandwidth cost on your end regardless of how large the scanned workspace is.

## BEM

BEM (Block Element Modifier) is a CSS naming convention for writing modular, readable styles.

- **Block** — a standalone component: `.card`
- **Element** — a part of a block: `.card__title`
- **Modifier** — a variation: `.card--featured`, `.card__title--large`
