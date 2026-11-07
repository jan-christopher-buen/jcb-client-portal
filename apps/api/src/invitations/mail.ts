import nodemailer from 'nodemailer'
import type { Config } from '../config.js'
import { HttpError } from '../errors.js'
export type InvitationMail = {
  email: string
  organization: string
  token: string
  invitationId: string
}
export type Mailer = (mail: InvitationMail) => Promise<void | { id: string }>
export class DeliveryError extends Error {
  constructor(public readonly ambiguous: boolean) {
    super('Invitation delivery could not be confirmed.')
  }
}
export function validateInvitationDelivery(config: Config, email: string) {
  if (config.INVITATION_MAIL_MODE === 'disabled')
    throw new HttpError(503, 'MAIL_DISABLED', 'Invitation email is disabled.')
  if (
    config.INVITATION_MAIL_MODE === 'resend' &&
    !config.invitationRecipients.includes(email)
  )
    throw new HttpError(
      400,
      'RECIPIENT_NOT_ALLOWED',
      'Use an approved staging recipient.',
    )
}
function text(config: Config, mail: InvitationMail) {
  return `You are invited to ${mail.organization}.\n\nOpen this link within 72 hours:\n${config.APP_ORIGIN}/invitation#token=${mail.token}\n\nSign in with the invited email if you have an account. Otherwise, create your client account with your name and password.\nThis is a staging invitation.`
}
export function resendMailer(
  config: Config,
  send: typeof fetch = fetch,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Mailer {
  return async (mail) => {
    validateInvitationDelivery(config, mail.email)
    const body = JSON.stringify({
      from: config.INVITATION_FROM,
      to: [mail.email],
      subject: 'Your jcb. staging invitation',
      text: text(config, mail),
    })
    let ambiguous = false
    const deadline = Date.now() + 12000
    for (let attempt = 0; attempt < 3; attempt++) {
      let delay = 200 * (attempt + 1)
      try {
        const response = await send('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${config.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `invitation/${mail.invitationId}`,
          },
          body,
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(3000, deadline - Date.now())),
          ),
        })
        if (response.ok) {
          const value: unknown = await response.json()
          if (
            value &&
            typeof value === 'object' &&
            'id' in value &&
            typeof value.id === 'string' &&
            value.id.length <= 200
          )
            return { id: value.id }
          throw new DeliveryError(true)
        }
        if (![408, 409, 429].includes(response.status) && response.status < 500)
          throw new DeliveryError(ambiguous)
        if (
          response.status >= 500 ||
          response.status === 408 ||
          response.status === 409
        )
          ambiguous = true
        const retry = response.headers.get('retry-after')
        if (retry) {
          const seconds = Number(retry)
          delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(retry) - Date.now()
          if (!Number.isFinite(delay) || delay > 1000)
            throw new DeliveryError(ambiguous)
          delay = Math.max(0, delay)
        }
      } catch (error) {
        if (error instanceof DeliveryError) throw error
        ambiguous = true
      }
      if (attempt === 2 || Date.now() + delay >= deadline) break
      await pause(delay)
    }
    throw new DeliveryError(ambiguous)
  }
}
export function localMailer(config: Config): Mailer {
  if (config.INVITATION_MAIL_MODE === 'resend') return resendMailer(config)
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  })
  return async (mail) => {
    validateInvitationDelivery(config, mail.email)
    if (config.NODE_ENV === 'production') throw new DeliveryError(false)
    await transport.sendMail({
      from: 'jcb client portal <portal@jcb.test>',
      to: mail.email,
      subject: 'Your jcb client portal invitation',
      text: text(config, mail),
    })
  }
}
