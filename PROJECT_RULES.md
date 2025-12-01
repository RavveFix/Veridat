# Project Rules for Antigravity Agent

This document defines the strict rules, technology stack, and architectural patterns for the Britta project. You must follow these guidelines for all code generation and modifications.

## 1. Technology Stack

### Frontend
-   **Core**: Vanilla TypeScript (ES6+), HTML5, CSS3 for legacy code.
-   **Component Framework**: **Preact** (~3kB) for new components. Use the adapter pattern (`mountPreactComponent`) to integrate with vanilla code.
-   **Build Tool**: Vite (for dev server and bundling) with `@preact/preset-vite`.
-   **Styling**: Vanilla CSS with CSS Variables for theming. No Tailwind or Bootstrap unless explicitly requested.
-   **State Management**: `localStorage` for persistence, Preact hooks (`useState`, `useEffect`) for component state.

### Backend
-   **Runtime**: Deno (via Supabase Edge Functions).
-   **Framework**: Supabase Edge Functions (serving as the API layer).
-   **Database**: Supabase PostgreSQL.
-   **AI**: Google Gemini API (accessed via Edge Functions).

## 2. Architecture & Patterns

### Frontend Component Pattern
We use a **hybrid architecture**, but are transitioning to **Preact-first**:

> [!IMPORTANT]
> **Rule**: All new UI logic MUST be built as Preact components in `src/components/`. Avoid writing new imperative "Vanilla JS" DOM manipulation in `src/main.ts` unless absolutely necessary for the "glue" layer.

#### Preact Components (Standard for new code)
Create functional components in `.tsx` files:
```typescript
import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

interface MyComponentProps {
    title: string;
}

export const MyComponent: FunctionComponent<MyComponentProps> = ({ title }) => {
    const [count, setCount] = useState(0);
    return <div>{title}: {count}</div>;
};
```

Mount using the adapter:
```typescript
import { mountPreactComponent } from '@/components/preact-adapter';
const unmount = mountPreactComponent(MyComponent, { title: 'Hello' }, container);
```

#### Class-Based Components (Legacy)
For complex vanilla TS components:
```typescript
export class MyComponent {
    private element: HTMLElement;

    constructor(containerId: string) {
        this.element = document.getElementById(containerId);
        this.init();
    }

    private init() {
        this.render();
        this.attachListeners();
    }

    private render() {
        this.element.innerHTML = `...`;
    }
}
```

### Service Layer Pattern (Backend)
Business logic must be encapsulated in reusable services within `supabase/functions/_shared/` or specific service files.
-   **GeminiService**: Handles AI interactions.
-   **FortnoxService**: Manages Fortnox API integration.

### Edge Functions
-   **Location**: `supabase/functions/`.
-   **Imports**: **Must** use `npm:` specifiers for node modules (e.g., `import ... from "npm:@supabase/supabase-js@2"`).
-   **CORS**: **Must** handle `OPTIONS` requests and include CORS headers in all responses.

## 3. Coding Standards

### TypeScript
-   **Strictness**: Use explicit types. Avoid `any` where possible.
-   **Async/Await**: Use modern async/await patterns.

### CSS
-   **Theming**: Use CSS variables defined in `src/styles/main.css` (e.g., `--bg-primary`, `--text-primary`).
-   **Scoped Styles**: If a component needs specific styles, create a corresponding CSS file in `src/styles/components/`.

## 4. Agent Workflow Rules

You are an **Agentic AI**. You must follow these workflows to ensure high-quality, verifiable work.

### Task Management
-   **`task.md`**: Always maintain a `task.md` artifact. Break down your work into granular tasks.
-   **`task_boundary`**: Call this tool at the start of every logical step. Update your status faithfully.

### Planning & Review
-   **`implementation_plan.md`**: For any task involving more than a simple fix (e.g., new feature, refactoring), you **MUST** create an implementation plan.
-   **User Review**: Use `notify_user` to request review of your plan *before* writing code.

### Verification
-   **Frontend**: Verify changes by checking the local dev server (`npm run dev`).
-   **Backend**: Verify Edge Functions using `supabase functions serve`.
-   **`walkthrough.md`**: After completing a significant task, create a walkthrough artifact showing what you did and how to verify it.

## 5. Critical Constraints
-   **Do not** delete `CLAUDE.md`.
-   **Do not** expose API keys in the frontend.
-   **Do not** change the database schema without a migration file.
