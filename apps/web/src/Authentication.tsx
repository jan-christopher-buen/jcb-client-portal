import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router'
import {
  loginSchema,
  nameSchema,
  passwordSchema,
  type Identity,
  type InvitationPreview,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useSession } from './session.js'
import styles from './App.module.css'
export function SignIn() {
  const { setUser, token } = useSession(),
    navigate = useNavigate()
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const input = loginSchema.safeParse({ email, password })
    if (!input.success) {
      setError('Enter a valid email and password.')
      return
    }
    setBusy(true)
    try {
      const data = await api<{ user: Identity }>(
        '/auth/login',
        'POST',
        input.data,
      )
      setUser(data.user)
      navigate(token ? '/invitation' : '/organizations')
    } catch (error) {
      setError(errorMessage(error))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.authLayout}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>YOUR PROJECT, IN ONE PLACE</p>
        <h1>
          Good work starts
          <br />
          with clarity.
        </h1>
        <p>Sign in to your shared client workspace.</p>
        <div className={styles.divider} />
        <p>
          Accounts are invitation-only.
          <br />
          Ask jcb for an invitation to get started.
        </p>
      </div>
      <section className={styles.card} aria-labelledby="signin-title">
        <span className={styles.step}>ACCESS YOUR WORKSPACE</span>
        <h2 id="signin-title">Welcome back.</h2>
        <p className={styles.description}>
          Use the email associated with your account.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <button className={styles.submit} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {token && (
          <p>
            <Link to="/invitation">Return to your invitation</Link>
          </p>
        )}
      </section>
    </div>
  )
}
export function Invitation() {
  const { user, setUser, token, setToken } = useSession(),
    navigate = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0)
  const [name, setName] = useState(''),
    [password, setPassword] = useState('')
  useEffect(() => {
    let live = true
    if (token)
      api<InvitationPreview>('/invitations/inspect', 'POST', { token })
        .then((data) => {
          if (live) {
            setPreview(data)
            setError('')
          }
        })
        .catch((error) => {
          if (live) setError(errorMessage(error))
        })
    return () => {
      live = false
    }
  }, [token, attempt])
  async function accept(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!preview) return
    if (
      !preview.accountExists &&
      (!nameSchema.safeParse(name).success ||
        !passwordSchema.safeParse(password).success)
    ) {
      setError('Enter your name and a password of 12–128 characters.')
      return
    }
    setBusy(true)
    try {
      const result = await api<{ user: Identity; organizationId: string }>(
        '/invitations/accept',
        'POST',
        { token, ...(!preview.accountExists ? { name, password } : {}) },
      )
      setUser(result.user)
      setToken(null)
      setPassword('')
      navigate(`/organizations/${result.organizationId}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  if (!token)
    return (
      <section>
        <h1>Open your invitation email</h1>
        <p>
          Use the invitation link to begin. If you refreshed this page, reopen
          the link from your email.
        </p>
        <Link to="/sign-in">Go to sign in</Link>
      </section>
    )
  return (
    <section
      className={`${styles.card} ${styles.invitation}`}
      aria-labelledby="invitation-title"
    >
      <span className={styles.step}>YOU'RE INVITED</span>
      <h1 id="invitation-title">Join your client workspace.</h1>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!preview ? (
        <>
          <p role="status">
            {error
              ? 'Unable to open this invitation.'
              : 'Checking your invitation…'}
          </p>
          {error && (
            <button onClick={() => setAttempt((v) => v + 1)}>Try again</button>
          )}
        </>
      ) : (
        <>
          <h2>{preview.organization}</h2>
          <p>
            Invited email: <strong>{preview.email}</strong>
          </p>
          <p>This invitation expires 72 hours after it was issued.</p>
          {user && user.email !== preview.email ? (
            <p role="alert">
              You are signed in as {user.email}. Sign out, then use the invited
              email to continue.
            </p>
          ) : preview.accountExists && !user ? (
            <>
              <p>
                You already have an account. Sign in first, then confirm your
                membership.
              </p>
              <Link className={styles.actionLink} to="/sign-in">
                Sign in to accept
              </Link>
            </>
          ) : (
            <form onSubmit={(event) => void accept(event)}>
              {!preview.accountExists && (
                <>
                  <p>
                    Create your client account. Your email is taken from this
                    invitation.
                  </p>
                  <label htmlFor="name">Your name</label>
                  <input
                    id="name"
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <label htmlFor="new-password">Create password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className={styles.description}>
                    Use 12–128 characters. A long, unique passphrase is
                    recommended.
                  </p>
                </>
              )}
              <button className={styles.submit} disabled={busy}>
                {busy
                  ? 'Accepting…'
                  : preview.accountExists
                    ? 'Accept invitation'
                    : 'Create account and accept'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
