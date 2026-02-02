# Veridat Project Structure

Reorganized according to recommended architecture.

##  Directory Structure

```
Veridat/
├── landing/                    # Landing page
│   └── index.html
│
├── app/                        # Main application
│   ├── index.html
│   ├── manifest.json
│   ├── service-worker.js
│   │
│   ├── assets/
│   │   ├── icons/             # App icons
│   │   │   ├── icon-192.png
│   │   │   └── icon-512.png
│   │   └── docs/              # Sample documents
│   │       └── faktura_telia.pdf
│   │
│   └── src/
│       ├── css/
│       │   └── main.css       # Main styles
│       └── js/
│           └── main.js        # Main JavaScript
│
├── docs/                       # Documentation
│   ├── SUPABASE_SETUP.md
│   └── system_instructions.md
│
├── supabase/                   # Backend (Supabase Edge Functions)
│   ├── functions/
│   └── services/
│
├── package.json
├── .env.example
├── .gitignore
└── README.md (this file)
```

## URLs

- **Landing page:** `http://localhost:8000/landing/`
- **Main app:** `http://localhost:8000/app/`

## Development

```bash
# Start local server
python3 -m http.server 8000

# Access landing page
open http://localhost:8000/landing/

# Access app
open http://localhost:8000/app/
```

## Features

- ✅ AI-powered bookkeeping assistant
- ✅ Multi-company support
- ✅ PWA (installable app)
- ✅ Offline support
- ✅ Chat history per company

## Tech Stack

- **Frontend:** Vanilla JavaScript, HTML, CSS
- **Backend:** Supabase Edge Functions (Deno)
- **AI:** Google Gemini 2.5 Flash
- **PWA:** Service Worker + Manifest
