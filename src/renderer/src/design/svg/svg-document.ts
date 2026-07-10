export const MAX_SVG_SOURCE_CHARS = 1_000_000
export const MAX_SVG_ELEMENTS = 5_000

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop', 'pattern',
  'clippath', 'mask', 'marker', 'symbol', 'use', 'image',
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
  'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence',
  'animate', 'animatetransform', 'animatemotion', 'mpath', 'set', 'style'
])

const ANIMATION_ELEMENTS = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
const SAFE_ANIMATED_ATTRIBUTES = new Set([
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'width', 'height', 'opacity', 'fill', 'fill-opacity', 'stroke',
  'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'transform', 'd', 'points', 'pathlength', 'offset', 'stop-color', 'stop-opacity'
])

export type SvgDiagnostic = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type SanitizedSvgDocument = {
  ok: true
  svg: string
  diagnostics: SvgDiagnostic[]
  animationCount: number
  visualElementCount: number
  durationMs: number
  viewBox?: string
}

export type InvalidSvgDocument = {
  ok: false
  diagnostics: SvgDiagnostic[]
}

export type SvgDocumentResult = SanitizedSvgDocument | InvalidSvgDocument

function diagnostic(
  severity: SvgDiagnostic['severity'],
  code: string,
  message: string
): SvgDiagnostic {
  return { severity, code, message }
}

function durationMs(value: string | null): number {
  const text = value?.trim().toLowerCase() ?? ''
  if (!text) return 0
  const ms = /^([\d.]+)ms$/.exec(text)
  if (ms) return Number(ms[1]) || 0
  const seconds = /^([\d.]+)s$/.exec(text)
  if (seconds) return (Number(seconds[1]) || 0) * 1000
  const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text)
  if (clock) {
    return (Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])) * 1000
  }
  return 0
}

function validViewBox(value: string): boolean {
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
}

function localFragmentReference(value: string): boolean {
  const normalized = value.trim()
  return normalized.startsWith('#') && /^#[A-Za-z_][\w:.-]*$/.test(normalized)
}

function safeDataImage(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim())
}

function hasUnsafeCss(value: string): boolean {
  if (/@import|javascript\s*:|(?:https?|file|ftp)\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) return true
  const urls = value.match(/url\(([^)]+)\)/gi) ?? []
  return urls.some((entry) => {
    const target = entry.slice(entry.indexOf('(') + 1, -1).trim().replace(/^['"]|['"]$/g, '')
    return !localFragmentReference(target) && !safeDataImage(target)
  })
}

function sanitizeElementAttributes(element: Element, diagnostics: SvgDiagnostic[]): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    const value = attribute.value
    if (name.startsWith('on')) {
      element.removeAttribute(attribute.name)
      diagnostics.push(diagnostic('warning', 'event-handler-removed', `Removed unsafe ${attribute.name} attribute.`))
      continue
    }
    if (name === 'href' || name === 'xlink:href' || name === 'src') {
      if (!localFragmentReference(value) && !safeDataImage(value)) {
        element.removeAttribute(attribute.name)
        diagnostics.push(diagnostic('warning', 'external-reference-removed', `Removed external reference from ${attribute.name}.`))
      }
      continue
    }
    if ((name === 'style' || value.includes('url(')) && hasUnsafeCss(value)) {
      element.removeAttribute(attribute.name)
      diagnostics.push(diagnostic('warning', 'unsafe-css-removed', `Removed unsafe CSS from ${attribute.name}.`))
    }
  }
  const tag = element.localName.toLowerCase()
  if (ANIMATION_ELEMENTS.has(tag)) {
    const attributeName = element.getAttribute('attributeName')?.trim().toLowerCase()
    if (attributeName && !SAFE_ANIMATED_ATTRIBUTES.has(attributeName)) {
      element.remove()
      diagnostics.push(diagnostic('warning', 'unsafe-animation-removed', `Removed animation of ${attributeName}.`))
    }
  }
  if (tag === 'style' && hasUnsafeCss(element.textContent ?? '')) {
    element.remove()
    diagnostics.push(diagnostic('warning', 'unsafe-style-block-removed', 'Removed a style block with external or executable CSS.'))
  }
}

export function parseAndSanitizeSvgDocument(raw: string): SvgDocumentResult {
  const diagnostics: SvgDiagnostic[] = []
  if (raw.length > MAX_SVG_SOURCE_CHARS) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'source-too-large', `SVG exceeds ${MAX_SVG_SOURCE_CHARS} characters.`)]
    }
  }
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'dom-parser-unavailable', 'SVG parsing is unavailable in this renderer.')]
    }
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet\b/i.test(raw)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'unsafe-xml-declaration', 'DOCTYPE, ENTITY, and xml-stylesheet declarations are not allowed in SVG artifacts.')]
    }
  }
  const document = new DOMParser().parseFromString(raw, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName.toLowerCase() !== 'svg') {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-svg', 'The file is not a valid standalone SVG document.')]
    }
  }
  const root = document.documentElement
  const namespace = root.getAttribute('xmlns')
  if (namespace && namespace !== 'http://www.w3.org/2000/svg') {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-namespace', 'SVG root uses an invalid XML namespace.')]
    }
  }
  const all = Array.from(root.querySelectorAll('*'))
  if (all.length + 1 > MAX_SVG_ELEMENTS) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'too-many-elements', `SVG contains more than ${MAX_SVG_ELEMENTS} elements.`)]
    }
  }
  const elements = [root, ...all]
  for (const element of elements.reverse()) {
    const tag = element.localName.toLowerCase()
    if (!ALLOWED_ELEMENTS.has(tag)) {
      element.remove()
      diagnostics.push(diagnostic('warning', 'element-removed', `Removed unsupported <${tag}> element.`))
      continue
    }
    sanitizeElementAttributes(element, diagnostics)
  }
  if (!namespace) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const viewBox = root.getAttribute('viewBox')
  if (!viewBox) {
    diagnostics.push(diagnostic('warning', 'missing-viewbox', 'SVG should define a viewBox for responsive scaling.'))
  } else if (!validViewBox(viewBox)) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'invalid-viewbox', 'SVG viewBox must contain four finite numbers with positive width and height.')]
    }
  }
  if (!root.querySelector('title')) diagnostics.push(diagnostic('warning', 'missing-title', 'SVG has no accessible <title>.'))
  if (!root.querySelector('desc')) diagnostics.push(diagnostic('warning', 'missing-description', 'SVG has no accessible <desc>.'))

  const ids = new Set<string>()
  for (const element of [root, ...Array.from(root.querySelectorAll('[id]'))]) {
    const id = element.getAttribute('id')?.trim()
    if (!id) continue
    if (!/^[A-Za-z_][\w:.-]*$/.test(id)) {
      element.removeAttribute('id')
      diagnostics.push(diagnostic('warning', 'invalid-id-removed', `Removed invalid SVG id "${id}".`))
    } else if (ids.has(id)) {
      element.removeAttribute('id')
      diagnostics.push(diagnostic('warning', 'duplicate-id-removed', `Removed duplicate SVG id "${id}".`))
    } else {
      ids.add(id)
    }
  }

  const animations = Array.from(root.querySelectorAll('animate, animateTransform, animateMotion, set'))
  const visualElementCount = root.querySelectorAll(
    'path, rect, circle, ellipse, line, polyline, polygon, text, use, image'
  ).length
  const maxDuration = animations.reduce((max, element) => {
    const own = durationMs(element.getAttribute('dur'))
    const begin = durationMs(element.getAttribute('begin'))
    const repeatText = element.getAttribute('repeatCount')?.trim().toLowerCase() ?? ''
    const repeat = repeatText && repeatText !== 'indefinite' ? Number(repeatText) : 1
    const cycles = Number.isFinite(repeat) && repeat > 0 ? Math.min(repeat, 1000) : 1
    return Math.max(max, own * cycles + begin)
  }, 0)
  root.setAttribute('width', '100%')
  root.setAttribute('height', '100%')
  root.setAttribute('preserveAspectRatio', root.getAttribute('preserveAspectRatio') || 'xMidYMid meet')
  return {
    ok: true,
    svg: new XMLSerializer().serializeToString(root),
    diagnostics,
    animationCount: animations.length,
    visualElementCount,
    durationMs: Math.max(1000, maxDuration || 4000),
    ...(viewBox ? { viewBox } : {})
  }
}

export function buildSvgPreviewDocument(svg: string, background: 'transparent' | 'light' | 'dark'): string {
  const backgroundCss = background === 'light'
    ? '#ffffff'
    : background === 'dark'
      ? '#111827'
      : 'repeating-conic-gradient(#e5e7eb 0 25%, #ffffff 0 50%) 0 / 20px 20px'
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none';"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:${backgroundCss}}svg{display:block;max-width:100%;max-height:100%}</style></head><body>${svg}</body></html>`
}
