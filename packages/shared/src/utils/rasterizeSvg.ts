import { blobToDataUrl } from "./importNormalization"

const DEFAULT_ICON_SIZE = 256

const normalizeSvgText = (svgText: string, size: number): string => {
  // Strip scripts as a defense-in-depth measure even though we rasterize.
  const stripped = svgText.replace(/<script[\s\S]*?<\/script>/gi, "")
  const parser = new DOMParser()
  const doc = parser.parseFromString(stripped, "image/svg+xml")
  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    return stripped
  }

  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  }

  if (!svg.getAttribute("viewBox")) {
    const w = Number.parseFloat(svg.getAttribute("width") ?? "")
    const h = Number.parseFloat(svg.getAttribute("height") ?? "")
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
    } else {
      svg.setAttribute("viewBox", `0 0 ${size} ${size}`)
    }
  }

  svg.setAttribute("width", String(size))
  svg.setAttribute("height", String(size))
  if (!svg.getAttribute("preserveAspectRatio")) {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet")
  }

  return new XMLSerializer().serializeToString(svg)
}

export async function rasterizeSvgTextToPngBlob(svgText: string, size = DEFAULT_ICON_SIZE): Promise<Blob> {
  const normalized = normalizeSvgText(svgText, size)
  const svgBlob = new Blob([normalized], { type: "image/svg+xml" })
  const url = URL.createObjectURL(svgBlob)

  try {
    const img = new Image()
    img.decoding = "async"

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("Failed to load SVG image"))
      img.src = url
    })

    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D context not available")

    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode PNG"))), "image/png")
    })
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function ensurePngBlobFromDataUrl(
  dataUrl: string,
  size = DEFAULT_ICON_SIZE
): Promise<{ blob: Blob; mimeType: string }> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const mimeType = (blob.type || "").toLowerCase()

  if (mimeType === "image/svg+xml") {
    const svgText = await blob.text()
    const pngBlob = await rasterizeSvgTextToPngBlob(svgText, size)
    return { blob: pngBlob, mimeType: "image/png" }
  }

  return { blob, mimeType: blob.type || "application/octet-stream" }
}

export async function fileToPngDataUrlIfSvg(file: File, size = DEFAULT_ICON_SIZE): Promise<string> {
  if (file.type === "image/svg+xml") {
    const text = await file.text()
    const pngBlob = await rasterizeSvgTextToPngBlob(text, size)
    return await blobToDataUrl(pngBlob)
  }

  return await blobToDataUrl(file)
}
