import { describe, expect, it } from 'vitest'
import { externalHttpsUrl, deliverableCreateSchema } from './index.js'
describe('deliverable HTTPS destination validation', () => {
  it('accepts canonical HTTPS DNS links without fetching destinations', () => {
    expect(
      externalHttpsUrl('https://EXAMPLE.com/demo?fictional=1#preview'),
    ).toBe('https://example.com/demo?fictional=1#preview')
    expect(externalHttpsUrl('https://example.com:8443/demo')).toBe(
      'https://example.com:8443/demo',
    )
  })
  it('rejects malformed URLs, userinfo, local names, every IP literal and unsafe schemes', () => {
    for (const url of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///tmp/x',
      '//example.com',
      'https:example.com',
      'https://',
      'https://@example.com',
      'https://user:pass@example.com',
      'https://localhost',
      'https://localhost./x',
      'https://a.localhost',
      'https://thing.local',
      'https://api.internal',
      'https://router.lan',
      'https://computer.home',
      'https://x.localdomain',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://169.254.169.254',
      'https://2130706433',
      'https://0x7f000001',
      'https://0177.0.0.1',
      'https://8.8.8.8',
      'https://[::1]',
      'https://[::ffff:127.0.0.1]',
      'https://[2001:4860:4860::8888]',
      'https://example.com:99999',
      'https://bad..example.com',
      'https://-bad.example.com',
      'https://example.com/with space',
      'https://example.com/\npath',
      'https://example.com\\@localhost',
      'https://example.com/%zz',
    ])
      expect(externalHttpsUrl(url), url).toBeNull()
  })
  it('bounds content and nested links and rejects unknown browser fields', () => {
    const input = {
      title: 'Preview',
      description: 'Text',
      required: true,
      position: 1,
      links: [],
    }
    expect(deliverableCreateSchema.safeParse(input).success).toBe(true)
    for (const extra of [
      { position: 0 },
      { position: 101 },
      { title: '' },
      { description: '' },
      { links: Array(6).fill({ label: 'x', url: 'https://example.com' }) },
      { links: [{ label: 'x', url: 'https://localhost' }] },
      { ownerId: 'browser-supplied' },
    ])
      expect(
        deliverableCreateSchema.safeParse({ ...input, ...extra }).success,
      ).toBe(false)
  })
})
