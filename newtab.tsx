// Plasmo entrypoint (keep at repo root).
// Implementation lives in `pages/NewTab.tsx` to keep the root directory tidy.

import "@neutab/shared/bootstrap/restoreTheme" // Must run before React/storage to prevent white flash.
import "@neutab/shared/bootstrap/preloadTheme"

export { default } from "~pages/NewTab"
