# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1] - 2024-05-20
### Added
- Initial scaffolding for LinkedIn Comment Tracker Chrome extension in `linkedin-comment-tracker-extension/`.
- `manifest.json` with correct permissions, host permissions, and content script/background setup for LinkedIn feed pages.
- Minimal `background.js` (service worker) and `contentScript.js` (sidebar injection logic).
- Placeholder icons in all required sizes.

### Changed
- Migrated from sample extension structure to a clean, product-specific folder and file layout.

### Removed
- All sample/demo code, files, and folders (including `sample-extension/`).
- Any context menu, image analysis, or popup logic from the previous sample.

---

This changelog follows [Semantic Release](https://semantic-release.gitbook.io/semantic-release/) conventions. 