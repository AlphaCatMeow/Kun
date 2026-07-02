import { describe, expect, it } from 'vitest'
import { shouldRenderHtmlFrameWebview } from './HtmlFrameOverlay'

describe('HtmlFrameOverlay preview gating', () => {
  it('keeps the webview unmounted while the preview file is only the skeleton', () => {
    expect(shouldRenderHtmlFrameWebview('file:///workspace/.kun-design/screen/v1.html', true)).toBe(false)
  })

  it('mounts the webview once a real preview URL is ready', () => {
    expect(shouldRenderHtmlFrameWebview('file:///workspace/.kun-design/screen/v1.html', false)).toBe(true)
  })

  it('does not mount a webview without an authorized file URL', () => {
    expect(shouldRenderHtmlFrameWebview('', false)).toBe(false)
  })
})
