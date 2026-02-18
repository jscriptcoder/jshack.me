# Theme

Terminal color theming via CSS custom properties. The active theme is stored in `Session` (persisted to IndexedDB) and applied by setting `--theme-*` variables on `document.documentElement`.

## Files

| File            | Description                                                                           |
| --------------- | ------------------------------------------------------------------------------------- |
| `themes.ts`     | Theme definitions, types (`ThemeId`, `ThemeColors`, `ThemeDefinition`), and validator |
| `applyTheme.ts` | Sets CSS custom properties on `:root` from a `ThemeDefinition`                        |

## Available Themes

| ID      | Name            | Style                         |
| ------- | --------------- | ----------------------------- |
| `amber` | Amber (default) | Classic amber-on-black CRT    |
| `green` | Green Phosphor  | Green-on-black terminal       |
| `cyan`  | Cyan            | Cyan/blue-on-black CRT        |
| `light` | Light           | Dark text on light background |

## Color Tokens

Each theme defines 14 semantic color tokens:

| Token              | CSS Variable                 | Usage                                             |
| ------------------ | ---------------------------- | ------------------------------------------------- |
| `bg`               | `--theme-bg`                 | Page and terminal background                      |
| `text`             | `--theme-text`               | Primary text (results, descriptions)              |
| `textBright`       | `--theme-text-bright`        | Bright text (banner, commands, input, headings)   |
| `textDim`          | `--theme-text-dim`           | Dim text (prompt, status bar, cursor position)    |
| `error`            | `--theme-error`              | Error messages                                    |
| `accent`           | `--theme-accent`             | Inverted backgrounds (nano title bar, key badges) |
| `accentText`       | `--theme-accent-text`        | Text on accent backgrounds                        |
| `border`           | `--theme-border`             | Input border, nano help bar background            |
| `scrollThumb`      | `--theme-scroll-thumb`       | Scrollbar thumb                                   |
| `scrollThumbHover` | `--theme-scroll-thumb-hover` | Scrollbar thumb on hover                          |
| `caret`            | `--theme-caret`              | Input cursor / caret color                        |
| `link`             | `--theme-link`               | Hyperlinks (author card)                          |
| `linkHover`        | `--theme-link-hover`         | Hyperlink hover state                             |
| `avatarBorder`     | `--theme-avatar-border`      | Author card avatar border                         |

## How It Works

### Application Flow

1. **Before React mounts** — `storageCache.ts` reads the persisted theme from IndexedDB and calls `applyTheme()` to set CSS variables immediately, preventing a flash of wrong colors.
2. **React mount** — `SessionContext` initializes with the cached theme value. A `useEffect` calls `applyTheme()` whenever `session.theme` changes.
3. **User switches theme** — `theme("green")` calls `setTheme` on the session context, which updates the persisted session and triggers the `useEffect` to apply the new CSS variables.

### CSS Variable Strategy

Components use inline `style` with `var(--theme-*)` instead of Tailwind color classes. Fallback values are defined in `:root` in `src/index.css` (amber defaults) so the page renders correctly before JavaScript runs.

```css
/* src/index.css */
:root {
  --theme-bg: #000000;
  --theme-text: #f59e0b;
  /* ... */
}
```

```tsx
/* Component usage */
<div style={{ color: 'var(--theme-text)' }}>Result text</div>
```

Scrollbar pseudo-elements and `body` styles in `src/index.css` also reference CSS variables directly.

## Adding a New Theme

1. Add the ID to the `ThemeId` union in `themes.ts`
2. Add a `ThemeDefinition` entry to the `THEMES` record with all 14 color tokens
3. The theme automatically appears in `theme()` output and is selectable by name

## User-Facing Command

`theme()` is an unrestricted command (available to all user types including guest):

- `theme()` — lists all themes, marks the active one with `*`
- `theme("green")` — switches to the named theme
- Theme choice persists across sessions via IndexedDB
- `reset("confirm")` resets theme back to amber (clears all IndexedDB data)
