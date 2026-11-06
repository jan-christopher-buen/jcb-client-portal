import { useEffect, useState } from 'react'
import { apiErrorSchema } from '@jcb/contracts'
import styles from './App.module.css'
type Status = 'loading' | 'signed-out' | 'error'
export function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/me', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (response) => {
        const body: unknown = await response.json()
        if (response.status !== 401 || !apiErrorSchema.safeParse(body).success)
          throw new Error('Unexpected session response')
        setStatus('signed-out')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    return () => controller.abort()
  }, [attempt])
  return (
    <div className={styles.layout}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <aside className={styles.sidebar} aria-label="Application shell">
        <a
          className={styles.brand}
          href="/sign-in"
          aria-label="jcb client portal home"
        >
          jcb<span>.</span>
        </a>
        <p className={styles.product}>client portal</p>
        <div className={styles.workspace}>
          <span className={styles.marker} aria-hidden="true">
            j
          </span>
          <div>
            Project workspace<small>Local foundation</small>
          </div>
        </div>
        <nav aria-label="Portal navigation">
          <a className={styles.active} href="/sign-in" aria-current="page">
            <span aria-hidden="true">↗</span> Sign in
          </a>
        </nav>
        <p className={styles.sidebarNote}>
          A clearer place for
          <br />
          your next project.
        </p>
        <div className={styles.sidebarFooter}>jcb · web development & SEO</div>
      </aside>
      <div className={styles.content}>
        <header className={styles.topbar}>
          <span>
            Workspace <span aria-hidden="true">/</span> <strong>Sign in</strong>
          </span>
          <span className={styles.badge}>M1 · Local preview</span>
        </header>
        <main id="main" className={styles.main} tabIndex={-1}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>YOUR PROJECT, IN ONE PLACE</p>
            <h1>
              Good work starts
              <br />
              with clarity.
            </h1>
            <p>
              A shared space for project scope, decisions,
              <br className={styles.desktopBreak} /> and the next steps ahead.
            </p>
            <div className={styles.divider} />
            <p className={styles.caption}>
              Built for thoughtful collaboration.
              <br />
              One milestone at a time.
            </p>
          </div>
          <section className={styles.card} aria-labelledby="sign-in-title">
            <span className={styles.step}>01 / ACCESS YOUR WORKSPACE</span>
            <h2 id="sign-in-title">Welcome back.</h2>
            <p className={styles.description}>
              Your client workspace begins here.
            </p>
            <div className={styles.notice}>
              <strong>Authentication is coming in M2.</strong>
              <p>
                This local preview shows the sign-in layout. Accounts,
                invitations, and protected workspaces are not available yet.
              </p>
            </div>
            <form
              onSubmit={(event) => event.preventDefault()}
              aria-describedby="form-note"
            >
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                disabled
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                disabled
              />
              <button className={styles.submit} disabled>
                Sign in <span aria-hidden="true">↗</span>
              </button>
              <p id="form-note" className={styles.formNote}>
                Sign in is disabled in this foundation preview.
              </p>
            </form>
            <div className={styles.connection} role="status" aria-live="polite">
              {status === 'loading'
                ? 'Checking API connection…'
                : status === 'signed-out'
                  ? 'API connected · Signed out'
                  : 'API unavailable. Check that the local server is running.'}
              {status === 'error' && (
                <button
                  onClick={() => {
                    setStatus('loading')
                    setAttempt((value) => value + 1)
                  }}
                >
                  Retry connection
                </button>
              )}
            </div>
          </section>
        </main>
        <footer className={styles.footer}>
          <span>jcb client portal</span>
          <span>Clear scope. Shared progress.</span>
        </footer>
      </div>
    </div>
  )
}
