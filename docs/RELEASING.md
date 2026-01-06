# Releasing

Britta follows **Semantic Versioning** and uses **Git tags** as the source of truth for releases.

## Branches & Tags

- `main`: always the latest development line.
- `release/v2`: stabilization + patch line for v2 (create when you start hardening).
- Tags: `v2.0.0`, `v2.0.1`, … are created from `release/v2` (or from `main` for small, low-risk releases).

## Cut a v2 Release

1. Create the release branch when you’re ready to stabilize:
   - `git switch -c release/v2`
2. Freeze scope:
   - Only bugfixes/docs/perf go into `release/v2`.
   - Land features in `main` and cherry-pick fixes into `release/v2` as needed.
3. Prepare release notes:
   - Move items from `## [Unreleased]` into a new section `## [2.0.0] - YYYY-MM-DD` in `CHANGELOG.md`.
   - Keep the in-app changelog in sync: `apps/web/src/constants/changelog.ts`.
4. Validate:
   - `npm run build`
   - `cd python-api && pytest tests/ -v` (if Python API changes)
5. Tag and push:
   - `git tag -a v2.0.0 -m "v2.0.0"`
   - `git push origin release/v2 --tags`

## Patch Releases

For `v2.0.1`+, land the fix in `main`, cherry-pick to `release/v2`, update `CHANGELOG.md`, tag from `release/v2`.
