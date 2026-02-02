# CSS Layout Architecture

This document explains the critical CSS patterns used in the Veridat chat
interface layout.

## Overview

The app uses a sidebar + main content layout with specific flexbox constraints
to ensure stable rendering.

```
┌──────────────────────────────────────────────────────────┐
│                      .app-layout                          │
├─────────────────┬────────────────────────────────────────┤
│   .sidebar      │           .main-content                 │
│ ┌─────────────┐ │  ┌──────────────────────────────────┐  │
│ │.sidebar-    │ │  │         .top-bar                  │  │
│ │  header     │ │  ├────────────────────────────────────┤  │
│ ├─────────────┤ │  │                                    │  │
│ │.sidebar-    │ │  │   .chat-wrapper / .welcome-hero    │  │
│ │  action     │ │  │                                    │  │
│ ├─────────────┤ │  │   (scrollable content)             │  │
│ │             │ │  │                                    │  │
│ │.sidebar-nav │ │  │                                    │  │
│ │ (scrolls)   │ │  ├────────────────────────────────────┤  │
│ │             │ │  │  .floating-input-container         │  │
│ ├─────────────┤ │  └──────────────────────────────────┘  │
│ │.sidebar-    │ │                                        │
│ │  footer     │ │                                        │
│ └─────────────┘ │                                        │
└─────────────────┴────────────────────────────────────────┘
```

## Critical CSS Rules

### Sidebar Fixed Elements

The sidebar header, action area, and footer must **never shrink** when the
conversation list grows:

```css
.sidebar-header {
  flex-shrink: 0; /* ← CRITICAL: prevents collapse */
}

.sidebar-action {
  flex-shrink: 0; /* ← CRITICAL: prevents collapse */
}

.sidebar-footer {
  flex-shrink: 0; /* ← CRITICAL: prevents collapse */
}
```

### Scrollable Content Areas

For flex children to scroll properly, they need `min-height: 0`:

```css
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  min-height: 0; /* ← CRITICAL: enables scrolling in flex child */
}

#conversation-list-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0; /* ← CRITICAL: enables scrolling in flex child */
}
```

### Chat View Display

The chat view uses flexbox, not block display, to maintain proper hierarchy:

```css
.chat-section:not(.welcome-state) #chat-view {
  display: flex !important; /* ← NOT block! */
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
```

### Floating Input Visibility

The input bar must always be visible with high z-index:

```css
.floating-input-container {
  display: flex !important;
  position: absolute;
  bottom: 0;
  z-index: 100;
  visibility: visible !important;
  opacity: 1 !important;
}
```

## Common Mistakes to Avoid

| ❌ Don't                                           | ✅ Do Instead                                            |
| -------------------------------------------------- | -------------------------------------------------------- |
| `display: block` on #chat-view                     | `display: flex`                                          |
| Forget `min-height: 0` on scrollable flex children | Always add it                                            |
| Forget `flex-shrink: 0` on fixed header/footer     | Always add it                                            |
| Use low z-index on input                           | Use z-index: 100+                                        |
| Rely on relative centering for header elements     | Use standardized 40px heights and 72px parent containers |

## Header Alignment Standards (Pixel-Perfect)

As of January 2026, the app implements a "Mathematical Zero" alignment strategy
for the header:

- **Global Axis**: A single horizontal border created via `.app-layout::after`
  at `top: 72px`. Individual `border-bottom` properties on header containers are
  prohibited.
- **Standard Height**: All interactive boxes in the header (`.logo-area`,
  `.sidebar-toggle`, `.current-company-name`, `.memory-button`,
  `.company-dropdown`) must be exactly **40px** tall.
- **Flex Centering**: All header containers (`.sidebar-header`, `.top-bar`) must
  use:
  ```css
  height: 72px;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  ```
- **Optical Shift**: Text-only elements (like `.logo-text`) may require a
  `padding-bottom: 1px` to align their visual baseline with icons like the
  hamburger or memory indicator.

## Related Files

- `src/styles/main.css` - Main styles including layout
- `src/controllers/ConversationController.ts` - Manages welcome/chat state
- `app/index.html` - HTML structure
