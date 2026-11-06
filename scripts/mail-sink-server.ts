import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { createServer } from 'node:http'
export function createMailSink() {
  const messages: { id: number; to: string; subject: string; text: string }[] =
    []
  let sequence = 0
  const smtp = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    logger: false,
    size: 32768,
    onData(stream, _session, callback) {
      simpleParser(stream, { maxHtmlLengthToParse: 32768 })
        .then((mail) => {
          messages.unshift({
            id: ++sequence,
            to: Array.isArray(mail.to)
              ? mail.to.map((v) => v.text).join(', ')
              : (mail.to?.text ?? ''),
            subject: mail.subject ?? '',
            text: mail.text ?? '',
          })
          messages.splice(50)
          callback()
        })
        .catch(() => callback(new Error('Unable to read local message.')))
    },
  })
  const http = createServer((req, res) => {
    const host = req.headers.host?.split(':')[0]
    if (!['127.0.0.1', 'localhost'].includes(host ?? '')) {
      res.writeHead(403).end()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    if (req.method !== 'GET') {
      res.writeHead(405).end()
      return
    }
    if (req.url === '/api/messages') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(messages))
      return
    }
    if (req.url === '/sink.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(String.raw`
async function refresh() {
 const messages = await (await fetch('/api/messages')).json()
 const list = document.querySelector('#messages'); list.replaceChildren()
 if (!messages.length) list.textContent = 'No messages yet. Create an invitation in the portal.'
 for (const message of messages) {
  const article = document.createElement('article'), heading = document.createElement('h2'), body = document.createElement('pre')
  heading.textContent = message.subject + ' — ' + message.to; body.textContent = message.text; article.append(heading, body)
  const url = message.text.match(/https?:[^\s]+/)?.[0]
  if (url) { const link = document.createElement('a'); link.href = url; link.textContent = 'Open invitation'; link.rel = 'noreferrer'; article.append(link) }
  list.append(article)
 }
}
document.querySelector('button').addEventListener('click', refresh); refresh()
`)
      return
    }
    if (req.url !== '/') {
      res.writeHead(404).end()
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>jcb local mail sink</title><h1>jcb. local mail sink</h1><p>Local development only. Messages stay in memory and disappear on restart. No external email is delivered.</p><button>Refresh messages</button><main id="messages" aria-live="polite"></main><script src="/sink.js"></script></html>',
    )
  })
  return { smtp, http, messages }
}
