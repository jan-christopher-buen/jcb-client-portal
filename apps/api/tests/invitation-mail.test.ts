import { describe, it, expect, vi } from 'vitest'
import { readConfig } from '../src/config.js'
import {
  DeliveryError,
  resendMailer,
  validateInvitationDelivery,
} from '../src/invitations/mail.js'
const env = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://portal.example.test',
  DATABASE_URL: 'postgresql://localhost/jcb_portal_test',
  SESSION_SECRET: 's'.repeat(40),
  INVITATION_MAIL_MODE: 'resend',
  RESEND_API_KEY: 'fictional-key',
  INVITATION_FROM: 'invites@example.test',
  STAGING_INVITATION_RECIPIENTS: 'client@example.test',
}
const mail = {
  email: 'client@example.test',
  organization: 'Fictional organization',
  token: 'a'.repeat(64),
  invitationId: 'invitation-id',
}
const config = readConfig(env)
describe('invitation email modes and Resend adapter (mocked HTTP only)', () => {
  it('defaults production to disabled and keeps local SMTP forbidden there', () => {
    const production = {
      ...env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://remote/db?sslmode=verify-full',
      INVITATION_MAIL_MODE: undefined,
    }
    expect(readConfig(production).INVITATION_MAIL_MODE).toBe('disabled')
    expect(() =>
      validateInvitationDelivery(readConfig(production), mail.email),
    ).toThrow('disabled')
    expect(() =>
      readConfig({ ...production, INVITATION_MAIL_MODE: 'local' }),
    ).toThrow()
  })
  it.each([
    'RESEND_API_KEY',
    'INVITATION_FROM',
    'STAGING_INVITATION_RECIPIENTS',
  ])('requires explicit %s without echoing values', (key) => {
    expect(() => readConfig({ ...env, [key]: undefined })).toThrow(
      'Invalid invitation mail configuration.',
    )
  })
  it('requires HTTPS invitation links whenever Resend is selected', () => {
    expect(() =>
      readConfig({ ...env, APP_ORIGIN: 'http://localhost:5173' }),
    ).toThrow('Invalid invitation mail configuration.')
  })
  it('uses an exact recipient allowlist', () => {
    for (const email of [
      'other@example.test',
      'client@example.test.evil',
      'client+extra@example.test',
    ])
      expect(() => validateInvitationDelivery(config, email)).toThrow(
        'approved staging recipient',
      )
  })
  it('retries with a fixed endpoint and identical body and idempotency header', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'message' }), { status: 200 }),
      )
    expect(await resendMailer(config, send, async () => {})(mail)).toEqual({
      id: 'message',
    })
    expect(send).toHaveBeenCalledTimes(2)
    const [url, first] = send.mock.calls[0]!,
      [, second] = send.mock.calls[1]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(first?.redirect).toBe('error')
    expect(first?.body).toBe(second?.body)
    expect(first?.headers).toEqual(second?.headers)
    expect((first?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'invitation/invitation-id',
    )
    const body = JSON.parse(first?.body as string)
    expect(body.text).toContain('/invitation#token=' + mail.token)
    expect(body.to).toEqual([mail.email])
  })
  it('never calls HTTP for a disallowed recipient', async () => {
    const send = vi.fn<typeof fetch>()
    await expect(
      resendMailer(config, send)({ ...mail, email: 'other@example.test' }),
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
  it.each([400, 401, 403, 422])(
    'does not retry permanent HTTP %s or expose provider diagnostics',
    async (status) => {
      const send = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('sensitive provider body', { status }))
      await expect(resendMailer(config, send)(mail)).rejects.toMatchObject({
        ambiguous: false,
        message: 'Invitation delivery could not be confirmed.',
      })
      expect(send).toHaveBeenCalledTimes(1)
    },
  )
  it('bounds retries and retains uncertainty after a network error followed by rejection', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('secret diagnostic'))
      .mockResolvedValue(new Response('', { status: 403 }))
    await expect(
      resendMailer(config, send, async () => {})(mail),
    ).rejects.toMatchObject({ ambiguous: true })
    expect(send).toHaveBeenCalledTimes(2)
  })
  it.each([408, 409])('keeps HTTP %s uncertain and bounded', async (status) => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('', { status }))
    await expect(
      resendMailer(config, send, async () => {})(mail),
    ).rejects.toMatchObject({ ambiguous: true })
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('stops after three ambiguous attempts', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'))
    await expect(
      resendMailer(config, send, async () => {})(mail),
    ).rejects.toBeInstanceOf(DeliveryError)
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('does not retry before a long Retry-After or mistake rate limits for success', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
      )
    await expect(resendMailer(config, send)(mail)).rejects.toMatchObject({
      ambiguous: false,
    })
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('treats malformed successful responses as uncertain', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(resendMailer(config, send)(mail)).rejects.toMatchObject({
      ambiguous: true,
    })
  })
})
