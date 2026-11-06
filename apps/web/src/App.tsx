import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router'
import type { Identity } from '@jcb/contracts'
import { api, ApiFailure, errorMessage } from './api.js'
import { Session } from './session.js'
import { SignIn, Invitation } from './Authentication.js'
import { Organizations, Organization } from './Organizations.js'
import styles from './App.module.css'
import { ProposalList, ProposalDetail } from './Proposals.js'
import { ProjectOverview, MilestoneReview } from './Projects.js'
import { DeliverableDetail, DeliverableEditor } from './Deliverables.js'
import { ChangeList, ChangeDetail, ChangeOfferEditor } from './Changes.js'
import { ProposalEditor } from './ProposalEditor.js'
function consumeToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (window.location.hash)
    window.history.replaceState(null, '', window.location.pathname)
  return token
}
const initialToken = consumeToken()
export function App() {
  const [user, setUser] = useState<Identity | null>(null)
  const [token, setToken] = useState(initialToken)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const navigate = useNavigate()
  useEffect(() => {
    let live = true
    api<{ user: Identity }>('/auth/me')
      .then((data) => {
        if (live) {
          setUser(data.user)
          setReady(true)
          setError('')
        }
      })
      .catch((error) => {
        if (!live) return
        if (error instanceof ApiFailure && error.status === 401) {
          setUser(null)
          setReady(true)
          setError('')
        } else setError(errorMessage(error))
      })
    return () => {
      live = false
    }
  }, [attempt])
  useEffect(() => {
    const capture = () => setToken(consumeToken())
    window.addEventListener('hashchange', capture)
    return () => window.removeEventListener('hashchange', capture)
  }, [])
  useEffect(() => {
    const ended = () => {
      setUser(null)
      navigate(token ? '/invitation' : '/sign-in')
    }
    window.addEventListener('jcb:session-ended', ended)
    return () => window.removeEventListener('jcb:session-ended', ended)
  }, [navigate, token])
  async function logout() {
    try {
      await api('/auth/logout', 'POST')
      setUser(null)
      setError('')
      navigate(token ? '/invitation' : '/sign-in')
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  return (
    <Session value={{ user, setUser, token, setToken }}>
      <div className={styles.layout}>
        <a className={styles.skip} href="#main">
          Skip to content
        </a>
        <aside className={styles.sidebar} aria-label="Application shell">
          <Link
            className={styles.brand}
            to="/"
            aria-label="jcb client portal home"
          >
            jcb<span>.</span>
          </Link>
          <p className={styles.product}>client portal</p>
          <div className={styles.workspace}>
            <span className={styles.marker} aria-hidden="true">
              j
            </span>
            <div>
              {user?.name ?? 'Client workspace'}
              <small>
                {user
                  ? user.role === 'OWNER'
                    ? 'Owner'
                    : 'Client'
                  : 'Invitation-only access'}
              </small>
            </div>
          </div>
          <nav aria-label="Portal navigation">
            <Link
              className={styles.active}
              to={user ? '/organizations' : '/sign-in'}
            >
              {user ? 'Organizations' : 'Sign in'}
            </Link>
            {token && (
              <Link className={styles.navLink} to="/invitation">
                Your invitation
              </Link>
            )}
          </nav>
          <p className={styles.sidebarNote}>
            A clearer place for
            <br />
            your next project.
          </p>
          <div className={styles.sidebarFooter}>
            jcb · web development & SEO
          </div>
        </aside>
        <div className={styles.content}>
          <header className={styles.topbar}>
            <span>
              Workspace <span aria-hidden="true">/</span>{' '}
              <strong>
                {user ? 'Client organizations' : 'Account access'}
              </strong>
            </span>
            {user && (
              <button
                className={styles.secondary}
                onClick={() => void logout()}
              >
                Sign out
              </button>
            )}
          </header>
          <main id="main" className={styles.workMain} tabIndex={-1}>
            {error && (
              <div className={styles.error} role="alert">
                {error}{' '}
                <button onClick={() => setAttempt((v) => v + 1)}>
                  Retry connection
                </button>
              </div>
            )}
            {!ready ? (
              <p role="status">Checking your session…</p>
            ) : (
              <Routes>
                <Route
                  path="/"
                  element={
                    <Navigate
                      to={user ? '/organizations' : '/sign-in'}
                      replace
                    />
                  }
                />
                <Route
                  path="/sign-in"
                  element={
                    user ? (
                      <Navigate
                        to={token ? '/invitation' : '/organizations'}
                        replace
                      />
                    ) : (
                      <SignIn />
                    )
                  }
                />
                <Route path="/invitation" element={<Invitation />} />
                <Route
                  path="/organizations"
                  element={
                    user ? (
                      <Organizations />
                    ) : (
                      <Navigate to="/sign-in" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:id"
                  element={
                    user ? <Organization /> : <Navigate to="/sign-in" replace />
                  }
                />
                <Route
                  path="/organizations/:orgId/proposals"
                  element={
                    user ? <ProposalList /> : <Navigate to="/sign-in" replace />
                  }
                />
                <Route
                  path="/organizations/:orgId/proposals/new"
                  element={
                    user?.role === 'OWNER' ? (
                      <ProposalEditor />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/proposals/:proposalId"
                  element={
                    user ? (
                      <ProposalDetail />
                    ) : (
                      <Navigate to="/sign-in" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/proposals/:proposalId/versions/:versionId/edit"
                  element={
                    user?.role === 'OWNER' ? (
                      <ProposalEditor />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/deliverables/:deliverableId"
                  element={
                    user ? (
                      <DeliverableDetail />
                    ) : (
                      <Navigate to="/sign-in" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/deliverables/:deliverableId/versions/:versionId/edit"
                  element={
                    user?.role === 'OWNER' ? (
                      <DeliverableEditor />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/changes"
                  element={
                    user ? <ChangeList /> : <Navigate to="/sign-in" replace />
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/changes/:requestId"
                  element={
                    user ? <ChangeDetail /> : <Navigate to="/sign-in" replace />
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/changes/:requestId/offers/:offerId/edit"
                  element={
                    user?.role === 'OWNER' ? (
                      <ChangeOfferEditor />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId/milestones/:milestoneId"
                  element={
                    user ? (
                      <MilestoneReview />
                    ) : (
                      <Navigate to="/sign-in" replace />
                    )
                  }
                />
                <Route
                  path="/organizations/:orgId/projects/:projectId"
                  element={
                    user ? (
                      <ProjectOverview />
                    ) : (
                      <Navigate to="/sign-in" replace />
                    )
                  }
                />
                <Route
                  path="*"
                  element={
                    <section>
                      <h1>Page unavailable</h1>
                      <Link to="/">Return to workspace</Link>
                    </section>
                  }
                />
              </Routes>
            )}
          </main>
          <footer className={styles.footer}>
            <span>jcb client portal</span>
            <span>Clear scope. Shared progress.</span>
          </footer>
        </div>
      </div>
    </Session>
  )
}
