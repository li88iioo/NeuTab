let lockCount = 0
let pulseTimer: number | null = null

const applyClass = () => {
  if (typeof document === "undefined") return
  document.body.classList.toggle("perf-interacting", lockCount > 0)
}

export const beginPerfInteracting = (): (() => void) => {
  if (typeof document === "undefined") return () => {}

  lockCount += 1
  applyClass()

  return () => {
    lockCount = Math.max(0, lockCount - 1)
    applyClass()
  }
}

export const pulsePerfInteracting = (durationMs = 180) => {
  if (typeof document === "undefined") return

  // If something already holds the lock (drag/scroll), don't schedule a removal.
  if (lockCount > 0) return

  document.body.classList.add("perf-interacting")
  if (pulseTimer != null) window.clearTimeout(pulseTimer)
  pulseTimer = window.setTimeout(() => {
    pulseTimer = null
    if (lockCount === 0) {
      document.body.classList.remove("perf-interacting")
    }
  }, durationMs)
}

