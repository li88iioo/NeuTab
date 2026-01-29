/**
 * @file theme-early-restore.js
 * @description Run before the app bundle loads to reduce flash-of-unstyled-content (FOUC).
 *
 * Notes:
 * - This is intentionally plain JS and tiny. It must not depend on the main bundle.
 * - It only reads localStorage caches and sets early background + <meta name="theme-color">.
 */

;(function () {
  try {
    var mode = localStorage.getItem("theme_mode_cache") || "auto"
    var visual = localStorage.getItem("visual_theme_cache") || "neumorphic"

    var prefersDark = false
    try {
      prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    } catch {}

    var isDark = mode === "dark" || (mode === "auto" && prefersDark)

    var bg
    if (visual === "liquid-glass") {
      bg = isDark ? "#050510" : "#f6f7ff"
    } else {
      bg = isDark ? "#292d32" : "#e0e5ec"
    }

    if (document.documentElement) {
      document.documentElement.style.backgroundColor = bg
    }

    var existing = document.getElementById("early-theme-style")
    if (!existing) {
      var style = document.createElement("style")
      style.id = "early-theme-style"
      style.textContent = "html,body{background-color:" + bg + " !important;}"
      document.head && document.head.appendChild(style)
    }

    try {
      var meta = document.querySelector('meta[name="theme-color"]')
      if (!meta && document.head) {
        meta = document.createElement("meta")
        meta.setAttribute("name", "theme-color")
        document.head.appendChild(meta)
      }
      if (meta) meta.setAttribute("content", bg)
    } catch {}
  } catch (err) {
    console.warn("[theme-early-restore] Failed to restore background early", err)
  }
})()

