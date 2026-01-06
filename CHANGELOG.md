# Changelog

All notable changes to the Britta project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Design**: Refined the Britta orb to a blue/gray enterprise palette with a subtle thinking sweep and no idle glow - `apps/web/src/styles/main.css`, `apps/web/src/components/Chat/ChatHistory.tsx`, `apps/web/app/index.html`

## [1.2.0] - 2025-12-03

### Added
- **Security**: Unit tests for API key validation (7 tests, 100% coverage) - `python-api/tests/test_security.py`
- **Testing**: pytest configuration with asyncio support - `python-api/pytest.ini`
- **Testing**: API verification script improvements with configurable BASE_URL - `python-api/verify_api.py`
- **Reliability**: Retry logic for consent email delivery (3 attempts, exponential backoff) - `src/components/LegalConsentModal.tsx`
- **Reliability**: Railway cold start handling with retry logic (3 attempts) - `supabase/services/PythonAPIService.ts`
- **Debugging**: Error detail preservation in python-proxy with source tracking - `supabase/functions/python-proxy/index.ts`
- **Dependencies**: pytest, pytest-asyncio, httpx for testing - `python-api/requirements.txt`

### Changed
- **Security**: Migrated to constant-time API key comparison (`secrets.compare_digest`) to prevent timing attacks - `python-api/app/core/security.py`
- **Security**: Added comprehensive auth error handling in LegalConsentModal - `src/components/LegalConsentModal.tsx`
- **Modernization**: Replaced deprecated FastAPI `@app.on_event` with modern `lifespan` context manager - `python-api/app/main.py`
- **Code Quality**: Extracted magic number to named constant `FLOAT_TOLERANCE` - `python-api/verify_api.py`
- **Code Quality**: Made BASE_URL configurable via `PYTHON_API_URL` environment variable - `python-api/verify_api.py`

### Removed
- **Code Quality**: Unused `Decimal` import from verify_api.py

### Security
- **CRITICAL**: Fixed timing attack vulnerability in API key validation (now uses constant-time comparison)
- **HIGH**: Added error handling for Supabase auth to prevent crashes on network failures

### Fixed
- Railway cold starts no longer cause "Internal server error" for users (automatic retry)
- Consent email failures are now retried automatically (3 attempts)
- Error messages from Python API are now preserved with full context

### Testing
- Unit test coverage: 7/7 tests passing
- Security module: 100% code coverage
- API verification: Working correctly

### Commits
- `6596263` - refactor: Low priority code quality improvements
- `f67f860` - feat: Medium priority improvements - testing, retry, error handling
- `1dbe52d` - fix: Critical security and reliability improvements

---

## [1.1.0] - 2025-12-02

### Added
- Settings page with changelog integration
- Intelligent automatic routing for Excel VAT analysis
- Python API Supabase integration (Phase 3)
- Railway deployment for Python API

### Changed
- Upgraded pandas for Python 3.13 compatibility
- Copied svensk-ekonomi VATProcessor for Railway deployment

### Commits
- `c5e984f` - feat: Add Settings page, Changelog, and production improvements
- `e20b147` - feat: Implement intelligent automatic routing for Excel VAT analysis
- `17ee6c6` - feat: Add Python API Supabase integration (Phase 3)
- `53eedae` - fix: Copy svensk-ekonomi VATProcessor into python-api for Railway deployment
- `f65995b` - Fix: Upgrade pandas for Python 3.13 compatibility

---

## Version Summary

### [1.2.0] - Security & Reliability Release
**Focus**: Production hardening, security fixes, comprehensive testing

**Key Improvements**:
- 🔒 Timing attack protection
- 🛡️ Retry logic for cold starts and email
- 🧪 Unit tests (7 tests, 100% coverage)
- 🔍 Error detail preservation
- 🧹 Code quality improvements

**Impact**:
- Users: Better reliability during cold starts, no more random errors
- Developers: 100% test coverage for security, better debugging with detailed errors
- Security: Protected against timing attacks, graceful error handling

### [1.1.0] - Production Deployment Release
**Focus**: Python API deployment, intelligent routing, settings UI

---

## How to Use This Changelog

### For Developers
- Check recent changes before starting work
- Reference commit hashes for detailed diffs
- Use version numbers for deployment tags

### For Users
- See what's new in each release
- Understand bug fixes and improvements
- Track feature additions

### For Claude (AI)
- Read this file at session start to understand recent changes
- Reference commit hashes to review specific implementations
- Use "Recent Improvements" section in CLAUDE.md for detailed context

---

## Links

- **Repository**: [GitHub](https://github.com/RavveFix/Britta)
- **Issues**: [GitHub Issues](https://github.com/RavveFix/Britta/issues)
- **Documentation**: See CLAUDE.md for technical details
- **Deployment**: Railway (Python API), Supabase (Edge Functions), Vercel (Frontend)
