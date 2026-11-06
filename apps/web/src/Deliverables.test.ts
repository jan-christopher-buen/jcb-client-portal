import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExternalLinks } from './Deliverables.js'
describe('external deliverable destinations', () => {
  it('escapes labels, denies unsafe hrefs and marks external links without implying privacy', () => {
    const html = renderToStaticMarkup(
      createElement(ExternalLinks, {
        links: [
          {
            label: '<img src=x onerror=alert(1)>',
            url: 'https://example.com/demo',
          },
          { label: 'Unsafe', url: 'javascript:alert(1)' },
        ],
      }),
    )
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer external"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain(
      'Portal authorization does not make linked files private',
    )
    expect(html).toContain('HTTPS does not guarantee safe content')
  })
})
