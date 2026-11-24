# Manyflows workspace design

Manyflows opens on campaign results. The same workspace also handles dense contact records, conversation history, and a long campaign editor. Each surface gives the most space to the work people do there.

## Foundations

Edit `src/client/theme.css` to change the design system. The workspace uses locally hosted Geist Sans and Geist Mono. The type scale, spacing scale, control heights, corner radii, shadows, semantic colours, motion durations, and reading widths live in that file.

| Role | Token | Where it belongs |
| --- | --- | --- |
| Canvas | `--paper` | Page background |
| Raised surface | `--card` | Menus, dialogs, and reading panels |
| Primary action and text | `--ink` | Create, Publish, and high-emphasis text |
| Accent | `--persimmon` | Selected indicators, focus, and funnel marks |
| Supporting text | `--muted-foreground` | Secondary labels, dates, and explanations |
| Operational state | `--success`, `--warning`, `--destructive` | A status with a visible text label |
| Control and section spacing | `--space-1` through `--space-9` | Inline gaps, insets, and page rhythm |

Typography, alignment, and whitespace give the workspace its character. Table values use tabular figures. Overview allows more space between sections. Record tables keep rows compact. Dividers mark row boundaries. Menus and dialogs use elevation to show their position above the page.

## Components and actions

- Use `PageHeading` for the title, optional supporting text, and page action. In the editor, keep Save draft and Publish together.
- Use `Button`, `IconButton`, `Field`, `Toggle`, `Status`, and `Dialog` from `components/ui.tsx`. Name icon-only controls for assistive technology. Keep focus indicators visible.
- Use `MoreActions` for occasional record actions. Its portal keeps menus visible at the edge of a scrolling table. Arrow keys move through items, Escape dismisses the menu, and destructive actions open the existing confirmation dialog.
- Use `MediaThumbnail` for post images and their media-type fallback. The editor and Content view share the same implementation.
- Keep the preview prominent on wide editor layouts. At narrow widths, keep the form and preview readable in one column. Hide scrollbar tracks while preserving native wheel, touch, and keyboard scrolling.
- Keep feedback on frequently used controls brief. Respect reduced motion. Data updates and keyboard navigation should be immediately legible.

## Implementation and verification

`src/client/styles.css` is the import manifest. Shared controls, the shell, records, the campaign editor, Demo Studio, login, and responsive rules have dedicated stylesheets in `src/client/styles/`. Overview and MoreActions own their scoped styles beside their components. Reference theme tokens for shared design values and use component-local variables for layout dimensions specific to a surface.

Run `npm run check` and `npm run test:e2e` after UI changes. The Playwright suite exercises the running application and its HTTP endpoints, including keyboard and touch interactions and desktop, tablet, and phone layouts.
