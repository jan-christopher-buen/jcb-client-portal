import 'dotenv/config'
import { createMailSink } from './mail-sink-server.js'
if (process.env.NODE_ENV === 'production')
  throw new Error('Local mail sink is disabled in production.')
const { smtp, http } = createMailSink()
smtp.on('error', () => {
  console.error('Local SMTP sink failed to start.')
  process.exitCode = 1
  http.close()
})
http.on('error', () => {
  console.error('Local mail UI failed to start.')
  process.exitCode = 1
  smtp.close()
})
smtp.listen(1025, '127.0.0.1', () =>
  console.info('Local SMTP sink: 127.0.0.1:1025'),
)
http.listen(8025, '127.0.0.1', () =>
  console.info('Local inbox: http://127.0.0.1:8025'),
)
function close() {
  smtp.close()
  http.close()
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
