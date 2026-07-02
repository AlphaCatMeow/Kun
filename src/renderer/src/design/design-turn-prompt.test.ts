import { describe, expect, it } from 'vitest'
import {
  buildCodeCanvasTurnPrompt,
  buildDesignFromCodePrompt,
  buildDesignImageNodePrompt,
  buildDesignTurnPrompt,
  buildParallelDesignPagesPrompt,
  buildPrototypeHref
} from './design-turn-prompt'
import type { ScreenTurnOptions } from './design-turn-prompt'
import { snapshotCanvas } from './canvas/canvas-snapshot'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from './canvas/canvas-types'
import { setLastLintFindings } from './canvas/design-lint'
import { useDesignSystemStore } from './canvas/design-system-store'

describe('design turn prompt', () => {
  it('builds a parallel page fanout prompt with one delegate_task per artifact', () => {
    const prompt = buildParallelDesignPagesPrompt({
      workspaceRoot: '/workspace',
      projectBrief: 'IKUN community site',
      jobs: [
        {
          artifactId: 'landing',
          title: 'Landing',
          relativePath: '.kun-design/doc/landing/v1.html',
          designMdPath: '.kun-design/doc/landing/DESIGN.md',
          brief: 'Hero, featured movies, footer',
          screenManifest: []
        },
        {
          artifactId: 'community',
          title: 'Community',
          relativePath: '.kun-design/doc/community/v1.html',
          designMdPath: '.kun-design/doc/community/DESIGN.md',
          brief: 'Community feed and member stories',
          screenManifest: [{ name: 'Design system', htmlPath: '.kun-design/doc/system/v1.html', role: 'design-system' }]
        }
      ]
    })

    expect(prompt).toContain('delegate_task')
    expect(prompt).toContain('SAME assistant message')
    expect(prompt).toContain('"profile": "general"')
    expect(prompt).toContain('"detach": false')
    expect(prompt).toContain('label: page:landing')
    expect(prompt).toContain('label: page:community')
    expect(prompt).toContain('Act as the design director for the fanout')
    expect(prompt).toContain('real content, concrete states, and a clear primary action')
    expect(prompt).toContain('Design target: Web')
    expect(prompt).toContain('1280x800 desktop web')
    expect(prompt).toContain('Modify ONLY `.kun-design/doc/landing/v1.html` and `.kun-design/doc/landing/DESIGN.md`')
    expect(prompt).toContain('Modify ONLY `.kun-design/doc/community/v1.html` and `.kun-design/doc/community/DESIGN.md`')
    expect(prompt).toContain('Design delivery checklist')
    expect(prompt).toContain('Do NOT modify sibling files')
  })

  it('carries the selected app target into every parallel page child prompt', () => {
    const prompt = buildParallelDesignPagesPrompt({
      workspaceRoot: '/workspace',
      projectBrief: 'A habit tracker app',
      designContext: { designTarget: 'app' },
      jobs: [
        {
          artifactId: 'home',
          title: 'Today',
          relativePath: '.kun-design/doc/today/v1.html',
          designMdPath: '.kun-design/doc/today/DESIGN.md',
          brief: 'Today screen with habit streaks and check-ins',
          screenManifest: []
        }
      ]
    })

    expect(prompt).toContain('label: page:home')
    expect(prompt).toContain('Design target: App')
    expect(prompt).toContain('390x844 phone portrait')
    expect(prompt).toContain('mobile app screens')
    expect(prompt).not.toContain('Design target: Web')
    expect(prompt.indexOf('Design target: App')).toBeLessThan(prompt.indexOf('Job 1: Today'))
  })

  it('allows only the reserved HTML and companion design notes files for HTML turns', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Create a polished hero page',
      artifactRelativePath: '.kun-design/screen/v1.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain('Design target: Web')
    expect(prompt).toContain('1280x800 desktop web')
    expect(prompt).toContain(
      'Modify ONLY `.kun-design/screen/v1.html` and `.kun-design/screen/DESIGN.md`'
    )
    expect(prompt).toContain('it has already been pre-created')
    expect(prompt).toContain('responsive to arbitrary canvas frame sizes')
    expect(prompt).not.toContain('HTML iteration discipline')
    expect(prompt).toContain('Resize-adaptive HTML contract')
    expect(prompt).toContain('Treat the canvas frame/webview as a live, resizable viewport')
    expect(prompt).toContain('Do not lock the page to a fixed desktop canvas')
    expect(prompt).toContain('Secondary action path')
    expect(prompt).toContain('Brand navigation')
    expect(prompt).toContain('Product shell')
    expect(prompt).toContain('Visual anchor')
    expect(prompt).toContain('Product preview detail')
    expect(prompt).toContain('Trust proof')
    expect(prompt).toContain('Testimonial attribution')
    expect(prompt).toContain('Feature anatomy')
    expect(prompt).toContain('Portfolio/case-study anatomy')
    expect(prompt).toContain('Pricing anatomy')
    expect(prompt).toContain('Conversion close')
    expect(prompt).toContain('FAQ anatomy')
    expect(prompt).toContain('Lead form response')
    expect(prompt).toContain('Site footer')
    expect(prompt).toContain('First-screen hierarchy')
    expect(prompt).toContain('Hero viewport composition')
    expect(prompt).toContain('Prototype coherence')
    expect(prompt).toContain('Content realism')
    expect(prompt).toContain('no dead `href="#"` links or visual-only buttons')
    expect(prompt).toContain('Handoff notes')
  })

  it('biases screen prompts toward mobile app frames when the design target is app', () => {
    const options: ScreenTurnOptions = {
      target: 'screen',
      mode: 'text',
      text: 'Create a habit detail screen',
      artifactRelativePath: '.kun-design/habit/v1.html',
      workspaceRoot: '/workspace',
      screenName: 'Habit Detail',
      screenManifest: [],
      designContext: { designTarget: 'app' }
    }
    const prompt = buildDesignTurnPrompt(options)

    expect(prompt).toContain('Design target: App')
    expect(prompt).toContain('390x844 phone portrait')
    expect(prompt).toContain('mobile app screens')
  })

  it('passes selected screen frame details and notes file for screen turns', () => {
    const options: ScreenTurnOptions = {
      target: 'screen',
      mode: 'text',
      text: 'Make this a login page',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      screenName: 'Login',
      screenWidth: 420,
      screenHeight: 340,
      screenSizeMode: 'manual',
      screenManifest: [
        {
          name: 'Home',
          width: 1280,
          height: 720,
          htmlPath: '.kun-design/home/v1.html'
        }
      ]
    }
    const prompt = buildDesignTurnPrompt(options)

    expect(prompt).toContain('Selected screen frame: 420x340 canvas pixels.')
    expect(prompt).toContain('Canvas frame context: "Login"')
    expect(prompt).toContain('420x340 canvas pixels, sizeMode: manual')
    expect(prompt).toContain('Treat the selected frame size above as the real webview viewport')
    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain('Modify ONLY `.kun-design/screen/v2.html` and `.kun-design/screen/DESIGN.md`')
    expect(prompt).toContain('responsive to arbitrary selected frame sizes')
    expect(prompt).toContain('arbitrary resized frame sizes')
    expect(prompt).toContain('"Home" (1280x720)')
    expect(prompt).toContain('.kun-design/home/v1.html')
  })

  it('injects real frame dimensions into HTML iteration prompts', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Continue the design system page',
      artifactRelativePath: '.kun-design/system/v2.html',
      designNotesPath: '.kun-design/system/DESIGN.md',
      basePath: '.kun-design/system/v1.html',
      workspaceRoot: '/workspace',
      frameContext: {
        name: 'Design system',
        width: 1330,
        height: 1040,
        sizeMode: 'auto'
      }
    })

    expect(prompt).toContain('Canvas frame context: "Design system"')
    expect(prompt).toContain('1330x1040 canvas pixels, sizeMode: auto')
    expect(prompt).toContain('real webview viewport')
    expect(prompt).toContain('do not shrink the design')
  })

  it('includes sibling pages so HTML turns stay cohesive across the canvas', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Design a settings page',
      artifactRelativePath: '.kun-design/settings/v1.html',
      workspaceRoot: '/workspace',
      screenManifest: [
        { name: 'Home', htmlPath: '.kun-design/home/v1.html', summary: 'Landing page' },
        { name: 'Chat', width: 420, height: 720, htmlPath: '.kun-design/chat/v1.html' }
      ]
    })

    expect(prompt).toContain('Other pages already in this project')
    expect(prompt).toContain('"Home" → .kun-design/home/v1.html (prototype href: ../home/v1.html) — Landing page')
    expect(prompt).toContain('"Chat" (420x720) → .kun-design/chat/v1.html (prototype href: ../chat/v1.html)')
    expect(prompt).toContain('Prototype link markup contract')
    expect(prompt).toContain('Use `<a href="...">` for navigation items')
    expect(prompt).toContain('data-prototype-href')
    expect(prompt).toContain('data-prototype-target="Exact Screen Title"')
    expect(prompt).toContain('history.pushState')
    expect(prompt).toContain('history.replaceState')
    expect(prompt).toContain('history.back()')
    expect(prompt).toContain('history.go(-1)')
    expect(prompt).toContain('role="button"` or `role="tab"')
    expect(prompt).toContain('tabindex="0"')
    expect(prompt).toContain('Do NOT modify sibling files')
  })

  it('computes local prototype hrefs between generated HTML artifacts', () => {
    expect(buildPrototypeHref('.kun-design/doc/settings/v1.html', '.kun-design/doc/home/v1.html')).toBe('../home/v1.html')
    expect(buildPrototypeHref('.kun-design/doc/a/b/v1.html', '.kun-design/doc/c/v1.html')).toBe('../../c/v1.html')
    expect(buildPrototypeHref(undefined, '.kun-design/doc/home/v1.html')).toBe('.kun-design/doc/home/v1.html')
  })

  it('includes selected HTML element context for focused edits', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Change this to a warmer headline',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      htmlElementContext: {
        artifactId: 'screen',
        artifactTitle: 'Welcome page',
        artifactRelativePath: '.kun-design/screen/v1.html',
        selector: 'body > main:nth-of-type(1) > h1:nth-of-type(1)',
        tagName: 'H1',
        text: 'Hello World',
        html: '<h1 class="hero-title">Hello World</h1>'
      }
    })

    expect(prompt).toContain('Selected HTML element context:')
    expect(prompt).toContain('CSS selector: body > main:nth-of-type(1) > h1:nth-of-type(1)')
    expect(prompt).toContain('Tag: <h1>')
    expect(prompt).toContain('Current text: Hello World')
    expect(prompt).toContain('Treat this selected element as the binding target')
    expect(prompt).toContain('HTML iteration discipline')
    expect(prompt).toContain('prefer surgical `edit` calls over full rewrites')
    expect(prompt).toContain('Preserve unrelated DOM order')
    expect(prompt).toContain('existing prototype links')
    expect(prompt).toContain(
      'Selected-element edit: locate `body > main:nth-of-type(1) > h1:nth-of-type(1)`'
    )
    expect(prompt).toContain('Do not duplicate, relocate, or restyle unrelated sections')
  })

  it('adds iteration edit discipline for existing screen edits without requiring an element selection', () => {
    const options: ScreenTurnOptions = {
      target: 'screen',
      mode: 'text',
      text: 'Tighten the pricing card spacing',
      artifactRelativePath: '.kun-design/pricing/v2.html',
      basePath: '.kun-design/pricing/v1.html',
      workspaceRoot: '/workspace',
      screenName: 'Pricing',
      screenManifest: []
    }
    const prompt = buildDesignTurnPrompt(options)

    expect(prompt).toContain('HTML iteration discipline')
    expect(prompt).toContain('read the current design first')
    expect(prompt).toContain('CSS variables')
    expect(prompt).toContain('media queries')
    expect(prompt).not.toContain('Selected-element edit:')
  })

  it('injects previous HTML quality findings into iteration prompts', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Polish the page',
      artifactRelativePath: '.kun-design/screen/v2.html',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      qualityFindings: [
        {
          code: 'placeholder-content',
          severity: 'warning',
          message: 'The page still contains placeholders.',
          suggestion: 'Replace them with realistic domain copy.'
        }
      ]
    })

    expect(prompt).toContain('Previous version quality audit')
    expect(prompt).toContain('placeholder-content')
    expect(prompt).toContain('Replace them with realistic domain copy')
  })

  it('tells the agent the path + directory of selected design artifacts (no inlined content)', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Match this page to the canvas',
      artifactRelativePath: '.kun-design/board/settings/v1.html',
      workspaceRoot: '/workspace',
      contextLocations: [
        {
          title: 'Settings',
          kind: 'html',
          path: '.kun-design/board/settings/v1.html',
          directory: '.kun-design/board/settings'
        },
        {
          title: 'Hero',
          kind: 'image',
          path: '.deepseekgui-images/hero.png',
          directory: '.deepseekgui-images'
        }
      ]
    })

    expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
    expect(prompt).toContain('do not inline them wholesale')
    expect(prompt).toContain('Settings [html] → `.kun-design/board/settings/v1.html` (directory: `.kun-design/board/settings`)')
    expect(prompt).toContain('Hero [image] → `.deepseekgui-images/hero.png` (directory: `.deepseekgui-images`)')
  })

  it('renders per-sibling accent + font + summary in the screen manifest', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'a settings page',
      artifactRelativePath: '.kun-design/doc/p/v1.html',
      workspaceRoot: '/ws',
      screenManifest: [
        {
          name: 'Home',
          htmlPath: '.kun-design/doc/home/v1.html',
          summary: 'A teal landing page',
          accent: '#3b82d8',
          fontFamily: 'Inter'
        }
      ]
    })
    expect(prompt).toContain('accent #3b82d8')
    expect(prompt).toContain('font Inter')
    expect(prompt).toContain('— A teal landing page')
  })

  it('injects extracted design tokens (palette + type scale) into HTML turns for cohesion', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'a pricing page',
      artifactRelativePath: '.kun-design/doc/p/v1.html',
      workspaceRoot: '/ws',
      derivedTokens: {
        extracted: { colors: [], fonts: [], radii: [], spacing: [], typeScale: [], sampledColors: [], title: '' },
        palette: { primary: { base: '#3b82d8', ramp: [] }, neutral: { base: '#6b7280', ramp: [] } },
        typeRows: [
          { label: 'H1', sample: '', fontSize: '28px', fontWeight: '700', lineHeight: '1.2', fontFamily: 'Inter, sans-serif', px: 28 },
          { label: 'Body', sample: '', fontSize: '16px', fontWeight: '400', lineHeight: '1.6', fontFamily: 'Inter, sans-serif', px: 16 }
        ]
      }
    })
    expect(prompt).toContain('Existing design tokens to REUSE')
    expect(prompt).toContain('accent #3b82d8')
    expect(prompt).toContain('H1 28/700')
    expect(prompt).toContain('font Inter')
  })

  it('canvas turn prompt instructs reference_image_paths when a selected image has imageUrl', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const img = createDefaultShape('image', 50, 60)
    img.imageUrl = '.deepseekgui-images/old.png'
    img.width = 200
    img.height = 200
    doc.objects[img.id] = { ...img, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [img.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([img.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '把这张图改成夜晚风格',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    expect(prompt).toContain('reference_image_paths')
    expect(prompt).toContain('Editing or restyling an EXISTING image')
    expect(prompt).toContain('`imageUrl` for filled image shapes')
    expect(prompt).toContain('.deepseekgui-images/old.png')
    expect(prompt).toContain(
      'Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder`'
    )
  })

  it('steers a selected filled image + change verb to image editing, not a new HTML screen', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const img = createDefaultShape('image', 50, 60)
    img.imageUrl = '.deepseekgui-images/shot.png'
    img.width = 1280
    img.height = 800
    doc.objects[img.id] = { ...img, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [img.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([img.id]))

    // The user's real phrasing: ambiguous "把我的设计改成task" with the screenshot
    // selected. It must edit the image, not create a new screen and build HTML.
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '把我的设计改成task',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    // The intent-triage lanes are hoisted ABOVE the screen-creation vocabulary so the
    // model commits to the image-edit lane before screen creation can pre-empt it.
    const lanesAt = prompt.indexOf('FIRST classify the request')
    const createScreenAt = prompt.indexOf('`design_create_screen`')
    expect(lanesAt).toBeGreaterThanOrEqual(0)
    expect(createScreenAt).toBeGreaterThan(lanesAt)

    expect(prompt).toContain('EDIT AN EXISTING IMAGE')
    expect(prompt).toContain('MUST NOT use `design_create_screen` / `add-screen`')
    expect(prompt).toContain('把这张图改成…')
    expect(prompt).toContain('do NOT create a screen / add-screen')

    // Deterministic prior: the renderer pre-classifies the single selected filled
    // image and states it up front (with the exact id + path), hoisted ABOVE the
    // lane list, so a terse "task" brief can't drag it toward a new HTML screen.
    expect(prompt).toContain('IMPORTANT PRIOR')
    expect(prompt).toContain('EXACTLY ONE filled image selected')
    expect(prompt).toContain('.deepseekgui-images/shot.png')
    expect(prompt.indexOf('IMPORTANT PRIOR')).toBeLessThan(lanesAt)
  })

  it('does NOT emit the edit-image prior when the selection is ambiguous (multi-select or empty holder)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('image', 0, 0)
    a.imageUrl = '.deepseekgui-images/a.png'
    const b = createDefaultShape('image', 0, 0)
    b.imageUrl = '.deepseekgui-images/b.png'
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([a.id, b.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'do something',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })
    expect(prompt).not.toContain('IMPORTANT PRIOR')
  })

  it('lists multiple selected shapes explicitly in the canvas prompt', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('rect', 0, 0)
    a.name = 'Card A'
    const b = createDefaultShape('text', 0, 0)
    b.name = 'Label B'
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([a.id, b.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'align these',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws',
      canvasSnapshot
    })
    expect(prompt).toContain('2 shapes selected')
    expect(prompt).toContain('Card A')
    expect(prompt).toContain('Label B')
  })

  it('explains sampled line points and per-shape omitted vertices in canvas snapshots', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const draw = createDefaultShape('draw', 10, 20)
    draw.points = Array.from({ length: 120 }, (_, index) => ({ x: index, y: 0 }))
    doc.objects[draw.id] = { ...draw, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [draw.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([draw.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'smooth this stroke',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws',
      canvasSnapshot
    })

    expect(prompt).toContain('sampled absolute `points` for arrows/lines/freehand')
    expect(prompt).toContain('`pointsOmitted` when extra vertices were compacted')
    expect(prompt).toContain('"pointsOmitted": 72')
  })

  it('injects stashed canvas critique findings into the next canvas prompt once', () => {
    setLastLintFindings([
      {
        code: 'low-contrast',
        shapeId: 'text_1',
        message: '"Label" text #94a3b8 on #ffffff is 2.5:1 — below WCAG AA 4.5:1.'
      }
    ])

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'fix critique findings',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws'
    })

    expect(prompt).toContain('Design-system lint flagged 1 issue(s)')
    expect(prompt).toContain('[low-contrast] (text_1)')
    expect(prompt).toContain('below WCAG AA 4.5:1')

    const nextPrompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'another turn',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws'
    })
    expect(nextPrompt).not.toContain('Design-system lint flagged')
  })

  it('keeps code canvas lint feedback separate from design canvas lint feedback', () => {
    setLastLintFindings([
      {
        code: 'low-contrast',
        shapeId: 'design_text',
        message: 'Design text contrast needs repair.'
      }
    ])
    setLastLintFindings(
      [
        {
          code: 'small-hit-target',
          shapeId: 'code_button',
          message: 'Code whiteboard button needs a larger hit target.'
        }
      ],
      'code-canvas:thread-1'
    )

    const codePrompt = buildCodeCanvasTurnPrompt({
      workspaceRoot: '/ws',
      canvasFeedbackKey: 'code-canvas:thread-1'
    })
    expect(codePrompt).toContain('Code whiteboard button needs a larger hit target.')
    expect(codePrompt).not.toContain('Design text contrast needs repair.')

    const designPrompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'fix critique findings',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws'
    })
    expect(designPrompt).toContain('Design text contrast needs repair.')
    expect(designPrompt).not.toContain('Code whiteboard button needs a larger hit target.')
  })

  it('renders previous canvas-op errors so the agent can self-correct', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'try again',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      previousOpErrors: [
        { code: 'SHAPE_NOT_FOUND', message: 'No shape with id "ghost"', suggestion: 'Available shapes: "Card" (s_1)' }
      ]
    })
    expect(prompt).toContain('YOUR PREVIOUS canvas attempt had errors')
    expect(prompt).toContain('No shape with id "ghost"')
    expect(prompt).toContain('Available shapes: "Card" (s_1)')
  })

  it('canvas turn prompt frames screen creation as a dedicated design tool call', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).toContain('dedicated canvas tools')
    expect(prompt).toContain('Code sidebar whiteboard')
    expect(prompt).toContain('do not ask the user to manually create a canvas first')
    expect(prompt).toContain('`design_create_screen`')
    expect(prompt).toContain('Web -> desktop 1280x800, App -> mobile 390x844')
    expect(prompt).toContain('Omit width/height/devicePreset unless the user asks for a custom device or breakpoint')
    expect(prompt).toContain('omitted dimensions follow the current target')
    expect(prompt).toContain('Web -> saas/web components, App -> mobile/app components')
    expect(prompt).toContain('call the real canvas tools')
    expect(prompt).toContain('SKETCH A SCREEN OR UI FRAME')
    expect(prompt).toContain('No HTML artifact is generated in Code mode')
    expect(prompt).toContain('UI frame default is 1280x800 desktop web for explicit UI mockups only')
    expect(prompt).toContain('Code architecture, dependency, data-flow, and debugging diagrams are freeform whiteboard shapes')
    expect(prompt).toContain('In Code mode this creates plain editable frame shapes only; no HTML is generated.')
    expect(prompt).toContain('there is no follow-up HTML generation in Code mode')
    expect(prompt).toContain('Code-mode whiteboard override')
    expect(prompt).toContain('creates plain editable frame shapes here')
    expect(prompt).toContain('does NOT trigger follow-up HTML screen generation')
    expect(prompt).toContain('(empty canvas)')
    expect(prompt).not.toContain('Default screen frame')
    expect(prompt).not.toContain('the system generates its HTML afterwards')
    expect(prompt).not.toContain('The system auto-generates HTML afterwards')
    expect(prompt).not.toContain('each gets its HTML generated afterwards')
    expect(prompt).not.toContain('the system will AUTOMATICALLY generate the HTML content')
    expect(prompt).not.toContain('```design_canvas')
  })

  it('code canvas prompt carries the current whiteboard brief', () => {
    const prompt = buildCodeCanvasTurnPrompt({
      workspaceRoot: '/ws',
      text: 'Sketch a checkout flow on the code whiteboard'
    })

    expect(prompt).toContain('Brief:')
    expect(prompt).toContain('Sketch a checkout flow on the code whiteboard')
    expect(prompt).toContain('Code-mode whiteboard override')
  })

  it('code canvas prompt prioritizes architecture and flow diagrams over screen creation', () => {
    const codePrompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(codePrompt).toContain('MAP CODE / ARCHITECTURE / FLOW')
    expect(codePrompt).toContain('system architecture, code structure, module relationships')
    expect(codePrompt).toContain('Do NOT use `design_create_screen` unless they explicitly ask for a UI screen mockup')
    expect(codePrompt).toContain('services/modules as frames or rects')
    expect(codePrompt).toContain('data/events as arrows')

    const designPrompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Map the code architecture',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws'
    })
    expect(designPrompt).not.toContain('MAP CODE / ARCHITECTURE / FLOW')
    expect(designPrompt).not.toContain('services/modules as frames or rects')
  })

  it('design canvas prompt keeps HTML-generation guidance for screen creation', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Create a landing page screen',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/ws'
    })

    expect(prompt).toContain('BUILD OR REDESIGN A SCREEN')
    expect(prompt).toContain('The system auto-generates HTML afterwards')
    expect(prompt).toContain('the system will AUTOMATICALLY generate the HTML content')
    expect(prompt).not.toContain('Code sidebar whiteboard')
    expect(prompt).not.toContain('No HTML artifact is generated in Code mode')
  })

  it('code canvas prompt renders previous op errors for self-correction', () => {
    const prompt = buildCodeCanvasTurnPrompt({
      workspaceRoot: '/ws',
      previousOpErrors: [
        {
          code: 'PARENT_NOT_FOUND',
          message: 'Parent frame "missing_parent" was not found.',
          suggestion: 'Use an existing frame id from the snapshot.'
        }
      ]
    })

    expect(prompt).toContain('YOUR PREVIOUS canvas attempt had errors')
    expect(prompt).toContain('Parent frame "missing_parent" was not found.')
    expect(prompt).toContain('Use an existing frame id from the snapshot.')
    expect(prompt).toContain('Code-mode whiteboard override')
  })

  it('code canvas prompt uses only explicitly supplied design-system context', () => {
    const store = useDesignSystemStore.getState()
    store.resetSystem()
    store.setToken({ name: 'global/stale', kind: 'color', value: '#ef4444' })

    try {
      const promptWithoutContext = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(promptWithoutContext).not.toContain('global/stale')
      expect(promptWithoutContext).not.toContain('#ef4444')

      const promptWithContext = buildCodeCanvasTurnPrompt({
        workspaceRoot: '/ws',
        canvasDesignSystem: {
          tokens: {
            'thread/primary': { name: 'thread/primary', kind: 'color', value: '#14b8a6' }
          },
          components: {}
        }
      })
      expect(promptWithContext).toContain('thread/primary')
      expect(promptWithContext).toContain('#14b8a6')
      expect(promptWithContext).not.toContain('global/stale')
    } finally {
      store.resetSystem()
    }
  })

  it('code canvas prompt honors the current app target', () => {
    const prompt = buildCodeCanvasTurnPrompt({
      workspaceRoot: '/ws',
      designContext: { designTarget: 'app' }
    })

    expect(prompt).toContain('Design target: App')
    expect(prompt).toContain('UI frame default is 390x844 phone portrait for explicit UI mockups only')
    expect(prompt).toContain('new 390x844 UI frame placeholders')
    expect(prompt).toContain('- Target: App')
  })

  it('includes placement guidance for new screen coordinates', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const frame = createHtmlFrameShape('Home', 1160, 600, 'home', 'desktop')
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [frame.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set(), {
      viewBox: { x: 1000, y: 500, width: 1600, height: 1000 }
    })

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Add settings page',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    expect(prompt).toContain('The snapshot includes `placement`')
    expect(prompt).toContain('Before EVERY canvas tool call, inspect the current canvas snapshot below')
    expect(prompt).toContain('Preserve existing canvas objects unless the user explicitly asks to replace/delete them')
    expect(prompt).toContain('Do not place a new large object over an existing image or frame')
    expect(prompt).toContain('Treat ALL visible snapshot shapes as occupied canvas content')
    expect(prompt).toContain('For `design_system_template`, also prefer omitting `x`/`y`')
    expect(prompt).toContain('new 1280x800 target screen frames')
    expect(prompt).toContain('prefer omitting `x`/`y`')
    expect(prompt).toContain('placement.recommendedSlots')
    expect(prompt).toContain('"recommendedSlots"')
    expect(prompt).toContain('"occupiedFrames"')
    expect(prompt).toContain('"x": 2520')
  })

  it('canvas turn prompt keeps empty holder rule intact (no imageUrl leaked, reference rule still gated)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const empty = createDefaultShape('image', 0, 0)
    doc.objects[empty.id] = { ...empty, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [empty.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([empty.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Generate an image here',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    const snapshotBlockStart = prompt.indexOf('```json')
    const snapshotBlockEnd = prompt.indexOf('```', snapshotBlockStart + 6)
    const snapshotBlock = prompt.slice(snapshotBlockStart, snapshotBlockEnd)
    expect(snapshotBlock).not.toContain('.deepseekgui-images/')

    expect(prompt).toContain('selected EMPTY `image` holder')
    expect(prompt).toContain('Editing or restyling an EXISTING image')
    expect(prompt).toContain(
      'Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder`'
    )
  })

  it('canvas turn prompt qualifies the selected-image-holder rule to empty holders only', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).toContain('selected EMPTY `image` holder (no `imageUrl` field in the snapshot)')
    expect(prompt).toContain('STOP — this is an EDIT, not a fill')
    expect(prompt).not.toContain(
      'selected `image` (or an `image` holder): `generate_image` with `aspect_ratio`'
    )
  })

  it('canvas turn prompt routes frame/group containing one image child to the edit path', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).toContain('Implicit target via container')
    expect(prompt).toContain('EXACTLY ONE `image` child with an `imageUrl`')
    expect(prompt).toContain('do NOT add a new image')
  })

  it('canvas turn prompt drops the unenforceable selection-order claim for multi-reference composition', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).not.toContain('in selection order, capped at 4')
    expect(prompt).toContain('treated symmetrically')
    expect(prompt).toContain('order in the array is not load-bearing')
  })

  it('canvas turn prompt includes the verbatim-copy verification line for reference_image_paths', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).toContain(
      'Before constructing `reference_image_paths`, locate each target shape in the snapshot by its `id` and copy its `imageUrl` verbatim'
    )
    expect(prompt).toContain(
      'do not guess or reconstruct a path from the shape name, position, or any other field'
    )
  })

  it('carries app target sizing into code-to-design prompts', () => {
    const prompt = buildDesignFromCodePrompt({
      sourceRelativePath: 'src/App.tsx',
      artifactRelativePath: '.kun-design/doc/reverse/v1.html',
      workspaceRoot: '/workspace',
      designContext: { designTarget: 'app' }
    })

    expect(prompt).toContain('Design target: App')
    expect(prompt).toContain('390x844 phone portrait')
    expect(prompt).toContain('- Target: App')
  })

  it('carries default web target sizing into image-node prompts', () => {
    const prompt = buildDesignImageNodePrompt({
      text: 'Product preview',
      outputRelativePath: '.kun-design/doc/preview.png',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('Design target: Web')
    expect(prompt).toContain('1280x800 responsive web page')
    expect(prompt).toContain('- Target: Web')
  })

  it('tells the agent the canvas.json directory on a canvas turn', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Tidy up the selected layers',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      contextLocations: [
        {
          title: 'Design canvas',
          kind: 'canvas',
          path: '.kun-design/board/canvas.json',
          directory: '.kun-design/board'
        }
      ]
    })

    expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
    expect(prompt).toContain('Design canvas [canvas] → `.kun-design/board/canvas.json` (directory: `.kun-design/board`)')
  })
})
