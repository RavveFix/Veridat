# Application Page Flow

This document outlines the navigation flow of the Britta application.

## Overview

The application follows a simple multi-page architecture:

1.  **Landing Page** (`/`)
    *   **Purpose**: Marketing and introduction.
    *   **Actions**:
        *   "Logga in" -> Navigates to `/login`
        *   "Öppna Britta" -> Navigates to `/app/` (Direct access if already logged in)

2.  **Login Page** (`/login`)
    *   **Purpose**: User authentication (Magic Link via Supabase).
    *   **Actions**:
        *   Submit Email -> Sends magic link.
        *   "Tillbaka till startsidan" -> Navigates to `/`

3.  **Main Application** (`/app/`)
    *   **Purpose**: The core interface for the AI accountant.
    *   **Structure**:
        *   **Chat UI** (`/app/index.html`): Primary interface (sidebar + chat).
        *   **Settings modal**: Profile, legal info, and “Nyheter & Uppdateringar” (changelog entries).
    *   **Navigation**:
        *   Clean routes are rewritten by Vite (`apps/web/vite.config.ts`) and by Vercel (`vercel.json`).

## Directory Structure Mapping

*   `apps/web/index.html` -> Landing Page
*   `apps/web/login.html` -> Login Page
*   `apps/web/app/index.html` -> Main App (Chat)

## Assets

*   Shared styles and scripts are located in `apps/web/src/`.
*   Landing page code lives under `apps/web/src/landing/`.
*   Backend API surface is via Supabase Edge Functions under `supabase/functions/`.
