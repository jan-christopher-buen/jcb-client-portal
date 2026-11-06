import nodemailer from 'nodemailer'
import type { Config } from '../config.js'
import { HttpError } from '../errors.js'
export type InvitationMail = {
  email: string
  organization: string
  token: string
}
export type Mailer = (mail: InvitationMail) => Promise<void>
export function localMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  })
  return async ({ email, organization, token }) => {
    if (config.NODE_ENV === 'production')
      throw new HttpError(
        503,
        'MAIL_DISABLED',
        'Invitation delivery is not configured for production.',
      )
    await transport.sendMail({
      from: 'jcb client portal <portal@jcb.test>',
      to: email,
      subject: 'Your jcb client portal invitation',
      text: `You are invited to ${organization}.

Open this link within 72 hours:
${config.APP_ORIGIN}/invitation#token=${token}

If you already have an account, sign in with the invited email before accepting. Otherwise, set your name and password to create your client account.
`,
    })
  }
}
