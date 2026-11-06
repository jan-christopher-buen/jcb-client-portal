import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  formatPhp,
  type ProposalDto,
  type ProposalVersionDto,
  type ProjectDto,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useSession } from './session.js'
import { useResource } from './useResource.js'
import styles from './App.module.css'
export function ProposalList() {
  const { orgId } = useParams(),
    { user } = useSession()
  const [page, setPage] = useState(1),
    [projectPage, setProjectPage] = useState(1)
  const base = `/organizations/${orgId}`
  const list = useResource<{
    proposals: {
      id: string
      title: string
      number: number
      state: string
      projectId: string | null
    }[]
    hasMore: boolean
  }>(`${base}/proposals?page=${page}`)
  const projects = useResource<{
    projects: {
      id: string
      status: string
      approvedVersion: { title: string }
    }[]
    hasMore: boolean
  }>(`${base}/projects?page=${projectPage}`)
  return (
    <>
      <Link to={base}>← Organization</Link>
      <p className={styles.eyebrow}>SCOPE & DECISIONS</p>
      <h1>Proposals and projects</h1>
      <p>Review published scope and track recorded decisions.</p>
      {user?.role === 'OWNER' && (
        <Link className={styles.actionLink} to={`${base}/proposals/new`}>
          New proposal
        </Link>
      )}
      <section className={styles.panel}>
        <h2>Proposals</h2>
        {list.error && (
          <p role="alert" className={styles.error}>
            {list.error} <button onClick={list.reload}>Reload proposals</button>
          </p>
        )}
        {list.loading ? (
          <p role="status">Loading proposals…</p>
        ) : (
          list.data && (
            <>
              {!list.data.proposals.length ? (
                <p>
                  No proposals yet.{' '}
                  {user?.role === 'OWNER'
                    ? 'Create a draft to begin.'
                    : 'The owner has not shared a proposal with this organization.'}
                </p>
              ) : (
                <ul className={styles.recordList}>
                  {list.data.proposals.map((p) => (
                    <li key={p.id}>
                      <Link to={`${base}/proposals/${p.id}`}>{p.title}</Link>
                      <span>
                        v{p.number} · {p.state.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous proposals
                </button>
                <span>Page {page}</span>
                <button
                  disabled={!list.data.hasMore}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next proposals
                </button>
              </div>
            </>
          )
        )}
      </section>
      <section className={styles.panel}>
        <h2>Planned projects</h2>
        {projects.error && (
          <p role="alert" className={styles.error}>
            {projects.error}{' '}
            <button onClick={projects.reload}>Reload projects</button>
          </p>
        )}
        {projects.loading ? (
          <p role="status">Loading projects…</p>
        ) : (
          projects.data && (
            <>
              {!projects.data.projects.length ? (
                <p>
                  No planned projects yet. Approving a current proposal creates
                  one project.
                </p>
              ) : (
                <ul className={styles.recordList}>
                  {projects.data.projects.map((p) => (
                    <li key={p.id}>
                      <Link to={`${base}/projects/${p.id}`}>
                        {p.approvedVersion.title}
                      </Link>
                      <span>{p.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button
                  disabled={projectPage === 1}
                  onClick={() => setProjectPage((v) => v - 1)}
                >
                  Previous projects
                </button>
                <span>Page {projectPage}</span>
                <button
                  disabled={!projects.data.hasMore}
                  onClick={() => setProjectPage((v) => v + 1)}
                >
                  Next projects
                </button>
              </div>
            </>
          )
        )}
      </section>
    </>
  )
}
export function Snapshot({ version }: { version: ProposalVersionDto }) {
  return (
    <>
      <h2>{version.title}</h2>
      <p>
        <strong>
          Version {version.number} · {version.state.toLowerCase()}
        </strong>
      </p>
      <h3>Scope</h3>
      <p className={styles.preserveText}>{version.scope}</p>
      <h3>Exclusions</h3>
      <p className={styles.preserveText}>
        {version.exclusions || 'No exclusions recorded.'}
      </p>
      <h3>Delivery assumptions</h3>
      <p className={styles.preserveText}>
        {version.deliveryAssumptions || 'No delivery assumptions recorded.'}
      </p>
      <div
        className={styles.tableScroll}
        tabIndex={0}
        role="region"
        aria-label="Proposal cost breakdown"
      >
        <table className={styles.costTable}>
          <caption>Cost breakdown · PHP</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Unit price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {version.items.map((item, index) => (
              <tr key={index}>
                <td>{item.description}</td>
                <td>{item.quantity}</td>
                <td>{formatPhp(item.unitPriceMinor)}</td>
                <td>
                  {formatPhp(
                    (
                      BigInt(item.quantity) * BigInt(item.unitPriceMinor)
                    ).toString(),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td>{formatPhp(version.totalMinor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {version.internalNotes !== undefined && (
        <aside className={styles.notice}>
          <strong>Owner-only notes</strong>
          <p className={styles.preserveText}>
            {version.internalNotes || 'No internal notes.'}
          </p>
        </aside>
      )}
      {version.decision && (
        <section className={styles.notice} aria-label="Decision receipt">
          <h3>Decision receipt</h3>
          <p>
            {version.decision.outcome.toLowerCase()} by{' '}
            {version.decision.actor.name} · Version {version.number}
          </p>
          <time dateTime={version.decision.createdAt}>
            {new Intl.DateTimeFormat('en-PH', {
              timeZone: 'Asia/Manila',
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(version.decision.createdAt))}{' '}
            · Asia/Manila
          </time>
        </section>
      )}
    </>
  )
}
export function ProposalDetail() {
  const { orgId, proposalId } = useParams(),
    { user } = useSession(),
    [search, setSearch] = useSearchParams(),
    navigate = useNavigate()
  const base = `/organizations/${orgId}`,
    path = `${base}/proposals/${proposalId}`
  const resource = useResource<{ proposal: ProposalDto }>(path)
  const [busy, setBusy] = useState(false),
    pending = useRef(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const data = resource.data?.proposal
  const version =
    data?.versions.find((v) => v.id === search.get('version')) ??
    (search.has('version') ? undefined : data?.versions[0])
  async function action(kind: 'send' | 'revise' | 'APPROVED' | 'DECLINED') {
    if (!data || !version || pending.current) return
    const message =
      kind === 'send'
        ? `Publish version ${version.number}? It becomes visible to clients and supersedes the current sent version.`
        : kind === 'revise'
          ? 'Create a revision draft? The current published version remains available until the revision is sent.'
          : kind === 'APPROVED'
            ? `Approve version ${version.number} for ${formatPhp(version.totalMinor)}? This records your decision and creates one planned project.`
            : `Decline version ${version.number}? No project will be created.`
    pending.current = true
    if (!window.confirm(message)) {
      pending.current = false
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (kind === 'revise') {
        const result = await api<{ versionId: string }>(
          `${path}/versions`,
          'POST',
          {},
        )
        navigate(`${path}/versions/${result.versionId}/edit`)
        return
      }
      if (kind === 'send')
        await api(`${path}/versions/${version.id}/send`, 'POST', {
          expectedRevision: version.editRevision,
        })
      else
        await api(`${path}/versions/${version.id}/decision`, 'POST', {
          outcome: kind,
        })
      setNotice(kind === 'send' ? 'Version published.' : 'Decision recorded.')
      resource.reload()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Link to={`${base}/proposals`}>← Proposals and projects</Link>
      <h1>Proposal review</h1>
      {error && (
        <p className={styles.error} role="alert">
          {error} Your displayed version has been kept. Reload to check the
          current version.
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {resource.error && (
        <p className={styles.error} role="alert">
          {resource.error}
        </p>
      )}
      <button
        className={styles.secondary}
        disabled={busy}
        onClick={resource.reload}
      >
        Reload proposal
      </button>
      {resource.loading ? (
        <p role="status">Loading proposal…</p>
      ) : (
        data && (
          <>
            <nav className={styles.versionLinks} aria-label="Proposal versions">
              {data.versions.map((v) => (
                <button
                  key={v.id}
                  disabled={busy}
                  aria-pressed={version?.id === v.id}
                  onClick={() => {
                    setSearch({ version: v.id })
                    setError('')
                    setNotice('')
                  }}
                >
                  v{v.number} · {v.state.toLowerCase()}
                </button>
              ))}
            </nav>
            {!version ? (
              <p role="alert">
                Version unavailable. Select a published version above.
              </p>
            ) : (
              <section className={styles.panel}>
                <Snapshot version={version} />
                {version.id !== data.publishedVersionId &&
                  version.state !== 'DRAFT' && (
                    <p className={styles.notice}>
                      Historical version.{' '}
                      {data.publishedVersionId && (
                        <button
                          onClick={() =>
                            setSearch({ version: data.publishedVersionId! })
                          }
                        >
                          Open current published version
                        </button>
                      )}
                    </p>
                  )}
                {data.approved && (
                  <p className={styles.notice}>
                    This proposal is approved and locked. Further scope changes
                    require a future change-request workflow.
                  </p>
                )}
                {user?.role === 'OWNER' && !data.approved && (
                  <div className={styles.actions}>
                    {version.state === 'DRAFT' && (
                      <>
                        <Link
                          className={styles.actionLink}
                          to={`${path}/versions/${version.id}/edit`}
                        >
                          Edit draft
                        </Link>
                        <button
                          disabled={busy}
                          onClick={() => void action('send')}
                        >
                          {busy ? 'Working…' : 'Send version'}
                        </button>
                      </>
                    )}
                    {data.publishedVersionId &&
                      !data.versions.some((v) => v.state === 'DRAFT') && (
                        <button
                          disabled={busy}
                          onClick={() => void action('revise')}
                        >
                          Create revision draft
                        </button>
                      )}
                  </div>
                )}
                {user?.role === 'CLIENT' &&
                  data.publishedVersionId === version.id &&
                  version.state === 'SENT' && (
                    <div className={styles.actions}>
                      <button
                        disabled={busy}
                        onClick={() => void action('APPROVED')}
                      >
                        {busy ? 'Recording…' : 'Approve proposal'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void action('DECLINED')}
                      >
                        Decline proposal
                      </button>
                    </div>
                  )}
                {version.state === 'APPROVED' && data.projectId && (
                  <Link
                    className={styles.actionLink}
                    to={`${base}/projects/${data.projectId}`}
                  >
                    Open planned project
                  </Link>
                )}
              </section>
            )}
          </>
        )
      )}
    </>
  )
}
export function ProjectOverview() {
  const { orgId, projectId } = useParams()
  const base = `/organizations/${orgId}`
  const resource = useResource<{ project: ProjectDto }>(
    `${base}/projects/${projectId}`,
  )
  return (
    <>
      <Link to={`${base}/proposals`}>← Proposals and projects</Link>
      <h1>Project overview</h1>
      {resource.error && (
        <p role="alert" className={styles.error}>
          {resource.error}{' '}
          <button onClick={resource.reload}>Reload project</button>
        </p>
      )}
      {resource.loading ? (
        <p role="status">Loading project…</p>
      ) : (
        resource.data && (
          <>
            <p className={styles.notice}>
              Status: planned. Approved scope is shown below.
            </p>
            <Link
              to={`${base}/proposals/${resource.data.project.proposalId}?version=${resource.data.project.approvedVersion.id}`}
            >
              View approved proposal version
            </Link>
            <section className={styles.panel}>
              <Snapshot version={resource.data.project.approvedVersion} />
            </section>
          </>
        )
      )}
    </>
  )
}
