import { createHash, randomBytes } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { DOMParser, XMLSerializer, type Attr, type Document, type Element, type Node } from '@xmldom/xmldom'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import { assertCanWritePath } from './sandbox-policy.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

export const DESIGN_SVG_INSPECT_TOOL_NAME = 'design_svg_inspect'
export const DESIGN_SVG_EDIT_TOOL_NAME = 'design_svg_edit'
export const DESIGN_SVG_ANIMATE_TOOL_NAME = 'design_svg_animate'
export const DESIGN_SVG_VALIDATE_TOOL_NAME = 'design_svg_validate'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_SOURCE_BYTES = 1_000_000
const MAX_ELEMENTS = 5_000
const MAX_BATCH_OPS = 200

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'lineargradient', 'radialgradient', 'stop',
  'pattern', 'clippath', 'mask', 'marker', 'symbol', 'use', 'image',
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
  'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
  'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology',
  'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile',
  'feturbulence', 'animate', 'animatetransform', 'animatemotion', 'mpath', 'set', 'style'
])

const SAFE_ANIMATION_ATTRIBUTES = new Set([
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'width', 'height', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'd',
  'points', 'pathlength', 'offset', 'stop-color', 'stop-opacity'
])

const CANONICAL_TAGS: Record<string, string> = {
  textpath: 'textPath',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  animatetransform: 'animateTransform',
  animatemotion: 'animateMotion',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feconvolvematrix: 'feConvolveMatrix',
  fediffuselighting: 'feDiffuseLighting',
  fedisplacementmap: 'feDisplacementMap',
  fedistantlight: 'feDistantLight',
  fedropshadow: 'feDropShadow',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  femorphology: 'feMorphology',
  feoffset: 'feOffset',
  fepointlight: 'fePointLight',
  fespecularlighting: 'feSpecularLighting',
  fespotlight: 'feSpotLight',
  fetile: 'feTile',
  feturbulence: 'feTurbulence'
}

type Diagnostic = { severity: 'error' | 'warning'; code: string; message: string; elementId?: string }
type SvgElementSpec = {
  tag: string
  id?: string
  attributes?: Record<string, unknown>
  text?: string
  children?: SvgElementSpec[]
}

function advertised(context: ToolHostContext): boolean {
  return context.guiDesignMode === true && context.guiDesignArtifact?.kind === 'svg'
}

function nodes(list: { length: number; item(index: number): Node | null }): Node[] {
  const result: Node[] = []
  for (let index = 0; index < list.length; index += 1) {
    const item = list.item(index)
    if (item) result.push(item)
  }
  return result
}

function elements(root: Element): Element[] {
  return [root, ...nodes(root.getElementsByTagName('*')).filter((node): node is Element => node.nodeType === 1)]
}

function elementName(element: Element): string {
  return (element.localName || element.tagName).toLowerCase()
}

function validViewBox(value: string): boolean {
  const numbers = value.trim().split(/[\s,]+/).map(Number)
  return numbers.length === 4 && numbers.every(Number.isFinite) && numbers[2] > 0 && numbers[3] > 0
}

function rootOf(document: Document): Element {
  const root = document.documentElement
  if (!root) throw new Error('SVG document has no root element')
  return root
}

function findById(document: Document, id: string): Element | null {
  return elements(rootOf(document)).find((element) => element.getAttribute('id') === id) ?? null
}

function safeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^[A-Za-z_][\w:.-]*$/.test(id) ? id : null
}

function unsafeCss(value: string): boolean {
  if (/@import|javascript\s*:|(?:https?|file|ftp)\s*:|expression\s*\(|behavior\s*:|-moz-binding/i.test(value)) return true
  const urls = value.match(/url\(([^)]+)\)/gi) ?? []
  return urls.some((entry) => {
    const target = entry.slice(entry.indexOf('(') + 1, -1).trim().replace(/^['"]|['"]$/g, '')
    return !/^#[A-Za-z_][\w:.-]*$/.test(target) && !/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(target)
  })
}

function safeAttribute(name: string, value: string): boolean {
  const normalized = name.toLowerCase()
  if (!/^[A-Za-z_:][\w:.-]*$/.test(name) || normalized.startsWith('on')) return false
  if (/javascript\s*:/i.test(value)) return false
  if (normalized === 'href' || normalized === 'xlink:href' || normalized === 'src') {
    return /^#[A-Za-z_][\w:.-]*$/.test(value.trim()) ||
      /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value.trim())
  }
  return !((normalized === 'style' || value.includes('url(')) && unsafeCss(value))
}

function parseSvg(source: string): { document: Document; errors: string[] } {
  const errors: string[] = []
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet\b/i.test(source)) {
    errors.push('DOCTYPE, ENTITY, and xml-stylesheet declarations are not allowed')
  }
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') errors.push(message)
    }
  })
  let document: Document
  try {
    document = parser.parseFromString(source, 'image/svg+xml')
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
  if (elementName(rootOf(document)) !== 'svg') errors.push('root element must be <svg>')
  return { document, errors }
}

function validateDocument(document: Document, parseErrors: readonly string[] = []): Diagnostic[] {
  const diagnostics: Diagnostic[] = parseErrors.map((message) => ({ severity: 'error', code: 'xml-parse', message }))
  const root = rootOf(document)
  const all = elements(root)
  if (all.length > MAX_ELEMENTS) {
    diagnostics.push({ severity: 'error', code: 'too-many-elements', message: `SVG exceeds ${MAX_ELEMENTS} elements.` })
  }
  const namespace = root.getAttribute('xmlns')
  if (!namespace) diagnostics.push({ severity: 'warning', code: 'missing-namespace', message: `Add xmlns="${SVG_NS}" for a standalone SVG.` })
  else if (namespace !== SVG_NS) diagnostics.push({ severity: 'error', code: 'invalid-namespace', message: `SVG xmlns must be ${SVG_NS}.` })
  const ids = new Set<string>()
  for (const element of all) {
    const tag = elementName(element)
    const id = element.getAttribute('id') || undefined
    if (!ALLOWED_TAGS.has(tag)) {
      diagnostics.push({ severity: 'error', code: 'unsafe-element', message: `<${tag}> is not allowed.`, ...(id ? { elementId: id } : {}) })
    }
    if (id) {
      if (!safeId(id)) diagnostics.push({ severity: 'error', code: 'invalid-id', message: `Invalid id "${id}".`, elementId: id })
      else if (ids.has(id)) diagnostics.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate id "${id}".`, elementId: id })
      else ids.add(id)
    }
    for (const attribute of nodes(element.attributes).filter((node): node is Attr => node.nodeType === 2)) {
      if (!safeAttribute(attribute.name, attribute.value)) {
        diagnostics.push({ severity: 'error', code: 'unsafe-attribute', message: `Unsafe ${attribute.name} attribute.`, ...(id ? { elementId: id } : {}) })
      }
    }
    if (tag === 'style' && unsafeCss(element.textContent ?? '')) {
      diagnostics.push({ severity: 'error', code: 'unsafe-style', message: 'Style blocks cannot load external resources or executable CSS.', ...(id ? { elementId: id } : {}) })
    }
    if (tag === 'animate' || tag === 'set') {
      const attributeName = element.getAttribute('attributeName')?.toLowerCase()
      if (attributeName && !SAFE_ANIMATION_ATTRIBUTES.has(attributeName)) {
        diagnostics.push({ severity: 'error', code: 'unsafe-animation-property', message: `Animation property ${attributeName} is not allowed.`, ...(id ? { elementId: id } : {}) })
      }
    }
  }
  const viewBox = root.getAttribute('viewBox')
  if (!viewBox) diagnostics.push({ severity: 'warning', code: 'missing-viewbox', message: 'Add a viewBox for responsive scaling.' })
  else if (!validViewBox(viewBox)) diagnostics.push({ severity: 'error', code: 'invalid-viewbox', message: 'viewBox must contain four finite numbers with positive width and height.' })
  if (root.getElementsByTagName('title').length === 0) diagnostics.push({ severity: 'warning', code: 'missing-title', message: 'Add an accessible <title>.' })
  if (root.getElementsByTagName('desc').length === 0) diagnostics.push({ severity: 'warning', code: 'missing-description', message: 'Add an accessible <desc>.' })

  for (const element of all) {
    for (const attribute of nodes(element.attributes).filter((node): node is Attr => node.nodeType === 2)) {
      const refs = [...attribute.value.matchAll(/url\(#([A-Za-z_][\w:.-]*)\)/g)].map((match) => match[1])
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) refs.push(attribute.value.slice(1))
      for (const reference of refs) {
        const elementId = element.getAttribute('id') || undefined
        if (!ids.has(reference)) diagnostics.push({ severity: 'error', code: 'missing-reference', message: `Reference #${reference} does not exist.`, ...(elementId ? { elementId } : {}) })
      }
    }
  }
  return diagnostics
}

function attributesOf(element: Element): Record<string, string> {
  const output: Record<string, string> = {}
  for (const attribute of nodes(element.attributes).filter((node): node is Attr => node.nodeType === 2)) {
    if (['id', 'xmlns'].includes(attribute.name)) continue
    output[attribute.name] = attribute.value
  }
  return output
}

function inspectDocument(document: Document) {
  const root = rootOf(document)
  const all = elements(root)
  const animationTags = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
  return {
    viewBox: root.getAttribute('viewBox') ?? null,
    width: root.getAttribute('width') ?? null,
    height: root.getAttribute('height') ?? null,
    elementCount: all.length,
    animationCount: all.filter((element) => animationTags.has(elementName(element))).length,
    elements: all.slice(0, 400).map((element) => ({
      tag: elementName(element),
      id: element.getAttribute('id') || null,
      parentId: element.parentNode?.nodeType === 1 ? (element.parentNode as Element).getAttribute('id') || null : null,
      attributes: attributesOf(element),
      ...(element.childNodes.length === 1 && element.firstChild?.nodeType === 3
        ? { text: element.textContent?.slice(0, 200) ?? '' }
        : {})
    })),
    truncated: all.length > 400
  }
}

function specFrom(value: unknown, depth = 0): SvgElementSpec | null {
  if (depth > 32 || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.tag !== 'string') return null
  const children = Array.isArray(record.children)
    ? record.children.map((child) => specFrom(child, depth + 1))
    : []
  if (children.some((child) => child === null)) return null
  return {
    tag: record.tag,
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(record.attributes && typeof record.attributes === 'object' && !Array.isArray(record.attributes)
      ? { attributes: record.attributes as Record<string, unknown> }
      : {}),
    ...(typeof record.text === 'string' ? { text: record.text } : {}),
    ...(Array.isArray(record.children)
      ? { children: children.filter((item): item is SvgElementSpec => item !== null) }
      : {})
  }
}

function createElement(document: Document, spec: SvgElementSpec): Element {
  const tag = spec.tag.trim().toLowerCase()
  if (!ALLOWED_TAGS.has(tag) || tag === 'svg') throw new Error(`unsupported SVG element: ${spec.tag}`)
  const element = document.createElementNS(SVG_NS, CANONICAL_TAGS[tag] ?? tag)
  if (spec.id !== undefined) {
    const id = safeId(spec.id)
    if (!id) throw new Error(`invalid SVG id: ${spec.id}`)
    if (findById(document, id)) throw new Error(`SVG id already exists: ${id}`)
    element.setAttribute('id', id)
  }
  for (const [name, rawValue] of Object.entries(spec.attributes ?? {})) {
    if (rawValue === undefined || rawValue === null) continue
    const value = String(rawValue)
    if (!safeAttribute(name, value)) throw new Error(`unsafe SVG attribute: ${name}`)
    element.setAttribute(name, value)
  }
  if (spec.text !== undefined) element.appendChild(document.createTextNode(spec.text))
  for (const child of spec.children ?? []) element.appendChild(createElement(document, child))
  return element
}

function applyEditOperation(document: Document, operation: Record<string, unknown>): string[] {
  const op = typeof operation.op === 'string' ? operation.op : ''
  if (op === 'set-document') {
    const root = rootOf(document)
    const attrs = operation.attributes && typeof operation.attributes === 'object' && !Array.isArray(operation.attributes)
      ? operation.attributes as Record<string, unknown>
      : {}
    for (const [name, rawValue] of Object.entries(attrs)) {
      if (!['viewBox', 'width', 'height', 'preserveAspectRatio', 'role', 'aria-labelledby', 'xmlns'].includes(name)) {
        throw new Error(`unsupported document attribute: ${name}`)
      }
      if (rawValue === null || rawValue === undefined) {
        throw new Error(`document attribute ${name} cannot be null`)
      }
      const value = String(rawValue)
      if (name === 'xmlns' && value !== SVG_NS) throw new Error(`xmlns must be ${SVG_NS}`)
      if (!safeAttribute(name, value)) throw new Error(`unsafe SVG attribute: ${name}`)
      root.setAttribute(name, value)
    }
    return []
  }
  if (op === 'add') {
    const spec = specFrom(operation.element)
    if (!spec) throw new Error('add requires an element spec')
    const parentId = typeof operation.parentId === 'string' ? operation.parentId : ''
    const parent = parentId ? findById(document, parentId) : findById(document, 'artwork') ?? rootOf(document)
    if (!parent) throw new Error(`parent not found: ${parentId}`)
    const element = createElement(document, spec)
    parent.appendChild(element)
    const createdId = element.getAttribute('id') || undefined
    return createdId ? [createdId] : []
  }
  const id = safeId(operation.id)
  if (!id) throw new Error(`${op || 'operation'} requires a valid id`)
  const element = findById(document, id)
  if (!element || element === rootOf(document)) throw new Error(`SVG element not found or protected: ${id}`)
  if (op === 'delete') {
    element.parentNode?.removeChild(element)
    return [id]
  }
  if (op === 'update') {
    const attrs = operation.attributes && typeof operation.attributes === 'object' && !Array.isArray(operation.attributes)
      ? operation.attributes as Record<string, unknown>
      : {}
    for (const [name, rawValue] of Object.entries(attrs)) {
      if (rawValue === null) {
        element.removeAttribute(name)
        continue
      }
      const value = String(rawValue)
      if (!safeAttribute(name, value)) throw new Error(`unsafe SVG attribute: ${name}`)
      element.setAttribute(name, value)
    }
    if (Array.isArray(operation.removeAttributes)) {
      for (const name of operation.removeAttributes) if (typeof name === 'string') element.removeAttribute(name)
    }
    if (typeof operation.text === 'string') element.textContent = operation.text
    return [id]
  }
  if (op === 'reparent') {
    const parentId = safeId(operation.parentId)
    const parent = parentId ? findById(document, parentId) : null
    if (!parent) throw new Error(`parent not found: ${String(operation.parentId ?? '')}`)
    parent.appendChild(element)
    return [id]
  }
  if (op === 'reorder') {
    const parent = element.parentNode
    if (!parent) throw new Error(`element has no parent: ${id}`)
    const position = operation.position
    if (position === 'front') parent.appendChild(element)
    else if (position === 'back') parent.insertBefore(element, parent.firstChild)
    else throw new Error('reorder position must be front or back')
    return [id]
  }
  throw new Error(`unsupported SVG edit op: ${op}`)
}

function animationElement(document: Document, input: Record<string, unknown>): { target: Element; animation: Element; ids: string[] } {
  const targetId = safeId(input.targetId)
  if (!targetId) throw new Error('animation targetId is required')
  const target = findById(document, targetId)
  if (!target) throw new Error(`animation target not found: ${targetId}`)
  const requestedId = input.id
  const id = requestedId === undefined ? `anim_${randomBytes(4).toString('hex')}` : safeId(requestedId)
  if (!id) throw new Error(`invalid animation id: ${String(requestedId)}`)
  if (findById(document, id)) throw new Error(`animation id already exists: ${id}`)
  const kind = typeof input.kind === 'string' ? input.kind : 'attribute'
  const duration = input.durationMs === undefined ? 1000 : Number(input.durationMs)
  const delay = input.delayMs === undefined ? 0 : Number(input.delayMs)
  if (!Number.isFinite(duration) || duration < 1 || duration > 600_000) {
    throw new Error('durationMs must be between 1 and 600000')
  }
  if (!Number.isFinite(delay) || delay < 0 || delay > 600_000) {
    throw new Error('delayMs must be between 0 and 600000')
  }
  if (typeof input.iterations === 'number' && (!Number.isInteger(input.iterations) || input.iterations < 1 || input.iterations > 1000)) {
    throw new Error('iterations must be an integer between 1 and 1000 or infinite')
  }
  if (input.iterations !== undefined && typeof input.iterations !== 'number' && input.iterations !== 'infinite') {
    throw new Error('iterations must be an integer between 1 and 1000 or infinite')
  }
  const repeatCount = input.iterations === 'infinite'
    ? 'indefinite'
    : String(Math.max(1, typeof input.iterations === 'number' ? input.iterations : 1))
  let animation: Element
  if (kind === 'motion') {
    animation = document.createElementNS(SVG_NS, 'animateMotion')
    const path = typeof input.path === 'string' ? input.path.trim() : ''
    if (!path || path.length > 50_000) throw new Error('motion animation requires a path of at most 50000 characters')
    animation.setAttribute('path', path)
    animation.setAttribute('rotate', typeof input.rotate === 'string' ? input.rotate : 'auto')
  } else if (kind === 'transform') {
    animation = document.createElementNS(SVG_NS, 'animateTransform')
    const type = typeof input.transformType === 'string' ? input.transformType : ''
    if (!['translate', 'scale', 'rotate', 'skewX', 'skewY'].includes(type)) {
      throw new Error('transformType must be translate, scale, rotate, skewX, or skewY')
    }
    animation.setAttribute('attributeName', 'transform')
    animation.setAttribute('type', type)
  } else {
    animation = document.createElementNS(SVG_NS, 'animate')
    const attributeName = typeof input.attributeName === 'string' ? input.attributeName.trim().toLowerCase() : ''
    if (!SAFE_ANIMATION_ATTRIBUTES.has(attributeName)) throw new Error(`unsupported animation attribute: ${attributeName}`)
    animation.setAttribute('attributeName', attributeName)
  }
  animation.setAttribute('id', id)
  animation.setAttribute('dur', `${duration}ms`)
  if (delay > 0) animation.setAttribute('begin', `${delay}ms`)
  animation.setAttribute('repeatCount', repeatCount)
  animation.setAttribute('fill', input.fill === 'remove' ? 'remove' : 'freeze')
  if (kind !== 'motion') {
    const rawValues = Array.isArray(input.values) ? input.values : []
    if (rawValues.some((value) => typeof value !== 'string' && typeof value !== 'number')) {
      throw new Error('animation values must contain only strings or numbers')
    }
    const values = rawValues.map(String)
    if (values.length >= 2) {
      animation.setAttribute('values', values.join(';'))
    } else {
      if (input.from === undefined || input.to === undefined) {
        throw new Error('animation requires at least two values or both from and to')
      }
      if (
        (typeof input.from !== 'string' && typeof input.from !== 'number') ||
        (typeof input.to !== 'string' && typeof input.to !== 'number')
      ) {
        throw new Error('animation from and to must be strings or numbers')
      }
      animation.setAttribute('from', String(input.from))
      animation.setAttribute('to', String(input.to))
    }
    if (Array.isArray(input.keyTimes)) {
      const keyTimes = input.keyTimes.map(Number)
      const expected = values.length >= 2 ? values.length : 2
      if (
        keyTimes.length !== expected ||
        keyTimes.some((value, index) => !Number.isFinite(value) || value < 0 || value > 1 || (index > 0 && value < keyTimes[index - 1])) ||
        keyTimes[0] !== 0 ||
        keyTimes[keyTimes.length - 1] !== 1
      ) {
        throw new Error(`keyTimes must contain ${expected} ascending values from 0 to 1`)
      }
      animation.setAttribute('keyTimes', keyTimes.join(';'))
    }
    if (Array.isArray(input.keySplines)) {
      const segmentCount = (values.length >= 2 ? values.length : 2) - 1
      if (input.keySplines.length !== segmentCount) {
        throw new Error(`keySplines must contain ${segmentCount} cubic-bezier entries`)
      }
      const validSplines = input.keySplines.every((entry) => {
        if (typeof entry !== 'string') return false
        const splineValues = entry.trim().split(/[ ,]+/).map(Number)
        return splineValues.length === 4 && splineValues.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      })
      if (!validSplines) throw new Error('each keySpline must contain four values from 0 to 1')
      animation.setAttribute('calcMode', 'spline')
      animation.setAttribute('keySplines', input.keySplines.map(String).join(';'))
    }
  } else if (
    input.from !== undefined ||
    input.to !== undefined ||
    input.values !== undefined ||
    input.keyTimes !== undefined ||
    input.keySplines !== undefined
  ) {
    throw new Error('motion animation uses path; value and spline fields are not supported')
  }
  target.appendChild(animation)
  return { target, animation, ids: [targetId, id] }
}

async function svgFileContext(context: ToolHostContext, write: boolean) {
  const artifact = context.guiDesignArtifact
  if (context.guiDesignMode !== true || !artifact || artifact.kind !== 'svg') {
    throw new Error('SVG tools require an active Design-mode SVG artifact turn')
  }
  const resolved = await resolveWorkspacePath(artifact.relativePath, context)
  if (!resolved.relativePath.startsWith('.kun-design/') || !/\/v\d+\.svg$/i.test(resolved.relativePath)) {
    throw new Error('SVG artifact path must be a versioned file under .kun-design')
  }
  if (write) assertCanWritePath(resolved.absolutePath, context)
  return { ...resolved, artifact }
}

async function readSvg(context: ToolHostContext) {
  const file = await svgFileContext(context, false)
  const source = await readFile(file.absolutePath, 'utf8')
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) throw new Error(`SVG exceeds ${MAX_SOURCE_BYTES} bytes`)
  const parsed = parseSvg(source)
  return { ...file, source, ...parsed }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.kun-${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function toolError(error: unknown) {
  return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
}

export function createDesignSvgInspectTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SVG_INSPECT_TOOL_NAME,
    description: 'Inspect the active SVG artifact as a compact element tree with ids, attributes, animations, and validation findings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: advertised,
    execute: async (_args, context) => withToolBoundary(async () => {
      try {
        const current = await readSvg(context)
        return { output: { ok: true, path: current.relativePath, revision: revision(current.source), ...inspectDocument(current.document), diagnostics: validateDocument(current.document, current.errors) } }
      } catch (error) {
        return toolError(error)
      }
    })
  })
}

export function createDesignSvgEditTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SVG_EDIT_TOOL_NAME,
    description: 'Atomically set document geometry or add, update, delete, reparent, and reorder SVG elements in the active SVG artifact. Use stable element ids and batch related edits.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array', minItems: 1, maxItems: MAX_BATCH_OPS,
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['set-document', 'add', 'update', 'delete', 'reparent', 'reorder'],
                description: 'set-document changes viewBox/size; add creates a child; update changes attributes/text; delete removes a subtree; reparent moves an element; reorder moves it to front/back.'
              },
              id: { type: 'string', description: 'Stable id of an existing element for update/delete/reparent/reorder.' },
              parentId: { type: 'string', description: 'Existing parent id. Add defaults to the #artwork group.' },
              position: { type: 'string', enum: ['front', 'back'] },
              attributes: {
                type: 'object',
                description: 'SVG attributes. For set-document use viewBox, width, height, preserveAspectRatio, role, aria-labelledby, or the standard SVG xmlns. Null removes an attribute during update.',
                additionalProperties: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' }
                  ]
                }
              },
              removeAttributes: { type: 'array', items: { type: 'string' } },
              text: { type: 'string' },
              element: {
                type: 'object',
                description: 'Element spec for add: {tag,id?,attributes?,text?,children?}. Give editable visual layers stable ids.',
                properties: {
                  tag: { type: 'string' },
                  id: { type: 'string' },
                  attributes: { type: 'object', additionalProperties: true },
                  text: { type: 'string' },
                  children: { type: 'array', items: { type: 'object', additionalProperties: true } }
                },
                required: ['tag'],
                additionalProperties: false
              }
            },
            required: ['op'],
            additionalProperties: false
          }
        }
      },
      required: ['ops'],
      additionalProperties: false
    },
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: advertised,
    execute: async (args, context) => withToolBoundary(async () => {
      try {
        const file = await svgFileContext(context, true)
        return await withFileMutationQueue(file.absolutePath, async () => {
          const current = await readSvg(context)
          if (current.errors.length) throw new Error(`cannot edit invalid SVG: ${current.errors[0]}`)
          const ops = Array.isArray(args.ops) ? args.ops : []
          if (ops.length === 0 || ops.length > MAX_BATCH_OPS) throw new Error(`ops must contain 1-${MAX_BATCH_OPS} operations`)
          const affectedIds = new Set<string>()
          for (const value of ops) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('every SVG op must be an object')
            for (const id of applyEditOperation(current.document, value as Record<string, unknown>)) affectedIds.add(id)
          }
          const diagnostics = validateDocument(current.document)
          const errors = diagnostics.filter((item) => item.severity === 'error')
          if (errors.length) throw new Error(errors.map((item) => item.message).join(' '))
          const content = new XMLSerializer().serializeToString(current.document)
          await atomicWrite(file.absolutePath, content)
          return { output: { ok: true, path: file.relativePath, revision: revision(content), affectedIds: [...affectedIds], diagnostics } }
        })
      } catch (error) {
        return toolError(error)
      }
    })
  })
}

export function createDesignSvgAnimateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SVG_ANIMATE_TOOL_NAME,
    description: 'Add declarative SVG animations to existing element ids: attribute, transform, motion-path, or path-draw effects. The result remains a standalone animated SVG with no scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        animations: {
          type: 'array', minItems: 1, maxItems: 100,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, targetId: { type: 'string' },
              kind: { type: 'string', enum: ['attribute', 'transform', 'motion', 'path-draw'] },
              attributeName: { type: 'string' }, transformType: { type: 'string', enum: ['translate', 'scale', 'rotate', 'skewX', 'skewY'] },
              from: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              to: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              values: { type: 'array', minItems: 2, items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
              durationMs: { type: 'number', minimum: 1, maximum: 600000 },
              delayMs: { type: 'number', minimum: 0, maximum: 600000 },
              iterations: { anyOf: [{ type: 'integer', minimum: 1, maximum: 1000 }, { type: 'string', enum: ['infinite'] }] },
              keyTimes: { type: 'array', items: { type: 'number' } },
              keySplines: { type: 'array', items: { type: 'string' } },
              path: { type: 'string' }, rotate: { type: 'string' }, fill: { type: 'string', enum: ['freeze', 'remove'] }
            },
            required: ['targetId', 'kind'],
            additionalProperties: false
          }
        }
      },
      required: ['animations'],
      additionalProperties: false
    },
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: advertised,
    execute: async (args, context) => withToolBoundary(async () => {
      try {
        const file = await svgFileContext(context, true)
        return await withFileMutationQueue(file.absolutePath, async () => {
          const current = await readSvg(context)
          if (current.errors.length) throw new Error(`cannot animate invalid SVG: ${current.errors[0]}`)
          const inputs = Array.isArray(args.animations) ? args.animations : []
          if (inputs.length === 0 || inputs.length > 100) throw new Error('animations must contain 1-100 entries')
          const affectedIds = new Set<string>()
          for (const value of inputs) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('every animation must be an object')
            const input = value as Record<string, unknown>
            if (input.kind === 'path-draw') {
              input.attributeName = 'stroke-dashoffset'
              input.from = input.from ?? 1
              input.to = input.to ?? 0
              const targetId = safeId(input.targetId)
              const target = targetId ? findById(current.document, targetId) : null
              if (!target) throw new Error(`animation target not found: ${String(input.targetId ?? '')}`)
              if (elementName(target) !== 'path') throw new Error('path-draw animation requires a <path> target')
              target.setAttribute('pathLength', '1')
              target.setAttribute('stroke-dasharray', '1')
              target.setAttribute('stroke-dashoffset', '1')
              input.kind = 'attribute'
            }
            const created = animationElement(current.document, input)
            for (const id of created.ids) affectedIds.add(id)
          }
          const diagnostics = validateDocument(current.document)
          const errors = diagnostics.filter((item) => item.severity === 'error')
          if (errors.length) throw new Error(errors.map((item) => item.message).join(' '))
          const content = new XMLSerializer().serializeToString(current.document)
          await atomicWrite(file.absolutePath, content)
          return { output: { ok: true, path: file.relativePath, revision: revision(content), affectedIds: [...affectedIds], diagnostics } }
        })
      } catch (error) {
        return toolError(error)
      }
    })
  })
}

export function createDesignSvgValidateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SVG_VALIDATE_TOOL_NAME,
    description: 'Validate the active SVG artifact for XML structure, unsafe content, broken references, duplicate ids, accessibility, and animation compatibility.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: advertised,
    execute: async (_args, context) => withToolBoundary(async () => {
      try {
        const current = await readSvg(context)
        const diagnostics = validateDocument(current.document, current.errors)
        return { output: { ok: !diagnostics.some((item) => item.severity === 'error'), path: current.relativePath, revision: revision(current.source), diagnostics, ...inspectDocument(current.document) }, isError: diagnostics.some((item) => item.severity === 'error') }
      } catch (error) {
        return toolError(error)
      }
    })
  })
}

export function buildDesignSvgLocalTools(): LocalTool[] {
  return [
    createDesignSvgInspectTool(),
    createDesignSvgEditTool(),
    createDesignSvgAnimateTool(),
    createDesignSvgValidateTool()
  ]
}
