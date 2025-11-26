# Application Page Flow

This document outlines the navigation flow of the Britta application.

## Overview

The application follows a simple multi-page architecture:

1.  **Landing Page** (`/`)
    *   **Purpose**: Marketing and introduction.
    *   **Actions**:
        *   "Logga in" -> Navigates to `/login.html`
        *   "Öppna Britta" -> Navigates to `/app/` (Direct access if already logged in)

2.  **Login Page** (`/login.html`)
    *   **Purpose**: User authentication (Magic Link via Supabase).
    *   **Actions**:
        *   Submit Email -> Sends magic link.
        *   "Tillbaka till startsidan" -> Navigates to `/`

3.  **Main Application** (`/app/`)
    *   **Purpose**: The core interface for the AI accountant.
    *   **Structure**:
        *   **Chatt** (`/app/index.html`): The main chat interface.
        *   **Nyheter** (`/app/nyheter.html`): Changelog and updates.
    *   **Navigation**:
        *   Top Navigation Bar switches between Chat and News.

## Directory Structure Mapping

*   `index.html` -> Landing Page
*   `login.html` -> Login Page
*   `app/index.html` -> Main App (Chat)
*   `app/nyheter.html` -> News/Changelog

## Assets

*   Shared styles and scripts are located in `src/`.
*   `src/styles/changelog.css`: Styles for the news page.
*   `src/scripts/excelViewer.js`: Logic for the Excel viewer in the main app.
