// Plasmo entrypoint (keep at repo root).
// Implementation lives in `pages/NewTab.tsx` to keep the root directory tidy.

import "~bootstrap/restoreTheme" // Must run before React/storage to prevent white flash.
import "~bootstrap/preloadTheme"

export { default } from "~pages/NewTab"

