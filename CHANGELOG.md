# Changelog

## 2026-11-24

- Added the hero art for Aldric Vane and Corwin Ashguard: 2 badges, 6 ability icons, 8 portraits and 2 Almanac cards, cut to transparent WebP. The art isn't used by the game yet; heroes arrive with the rebuild. The model reference sheets are still to come.
- Verified with `npm run build` (2.9 MB, about 120 KB more, since the Almanac cards load automatically) and `git diff --check`.
- Documented the wrap-up workflow for recording checked work in one focused commit. Version bumps, Git pushes, and Claude artifact publishing each require an explicit request.
- Verified with `npm test` (114 tests), `npm run typecheck`, and `git diff --check`.
