import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Link,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import {
  deliverableCreateSchema,
  deliverableContentSchema,
  externalHttpsUrl,
  type DeliverableContent,
  type DeliverableListDto,
  type DeliverableDetailDto,
  type DeliverableVersionDto,
  type DeliverableDto,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useResource } from './useResource.js'
import { useSession } from './session.js'
import styles from './App.module.css'
const label = (s: string) => s.toLowerCase().replaceAll('_', ' ')
const time = (s: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(s))
function Failure({ error, reload }: { error: string; reload: () => void }) {
  return error ? (
    <p role="alert" className={styles.error}>
      {error} Your input has been kept.{' '}
      <button type="button" onClick={reload}>
        Reload latest state
      </button>
    </p>
  ) : null
}
export function ExternalLinks({
  links,
}: {
  links: DeliverableContent['links']
}) {
  return (
    <section aria-label="External deliverable links">
      <h3>External links</h3>
      <p>
        These are untrusted external destinations. Access is controlled by the
        external provider. Portal authorization does not make linked files
        private. HTTPS does not guarantee safe content.
      </p>
      {!links.length ? (
        <p>No external links.</p>
      ) : (
        <ul className={styles.prose}>
          {links.map((link, i) => {
            const href = externalHttpsUrl(link.url)
            return (
              <li key={i}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer external"
                    referrerPolicy="no-referrer"
                  >
                    {link.label} — external (new tab)
                  </a>
                ) : (
                  <span>External link unavailable.</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
export function ProjectDeliverables() {
  const { orgId, projectId } = useParams(),
    { user } = useSession(),
    base = `/organizations/${orgId}/projects/${projectId}/deliverables`,
    resource = useResource<DeliverableListDto>(base)
  const paused =
    resource.data &&
    ['ON_HOLD', 'CANCELLED'].includes(resource.data.project.status)
  const unused =
    Array.from({ length: 100 }, (_, i) => i + 1).find(
      (p) => !resource.data?.deliverables.some((d) => d.position === p),
    ) ?? 1
  return (
    <section>
      <h2>Deliverables</h2>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading deliverables…</p>
      ) : (
        resource.data && (
          <>
            {!resource.data.deliverables.length && (
              <p>No published deliverables yet.</p>
            )}
            <ul className={styles.recordList}>
              {resource.data.deliverables.map((d) => {
                const current = d.versions.find(
                    (v) => v.id === d.currentVersionId,
                  ),
                  draft = d.versions.find((v) => v.state === 'DRAFT'),
                  v = current ?? draft
                return (
                  <li key={d.id}>
                    <Link to={`${base}/${d.id}`}>
                      {d.position}. {v?.title ?? 'Deliverable'}
                    </Link>
                    <p>
                      {d.required ? 'Required' : 'Optional'} ·{' '}
                      {label(d.acceptance)}
                      {current && ` · Current v${current.number}`}
                      {user?.role === 'OWNER' &&
                        draft &&
                        ` · Owner draft v${draft.number}`}
                    </p>
                  </li>
                )
              })}
            </ul>
            <p>
              Deliverable acceptance does not complete the project. Linked
              resources remain under the external provider's access rules.
            </p>
            {user?.role === 'OWNER' &&
              !paused &&
              resource.data.deliverables.length < 100 && (
                <ContentForm
                  key={`new-${resource.data.deliverables.length}`}
                  base={base}
                  reload={resource.reload}
                  position={unused}
                />
              )}
            {paused && (
              <p>
                Workflow changes are unavailable while the project is on hold or
                cancelled.
              </p>
            )}
          </>
        )
      )}
    </section>
  )
}
export function DeliverableDetail() {
  const { orgId, projectId, deliverableId } = useParams(),
    { user } = useSession(),
    navigate = useNavigate(),
    [search, setSearch] = useSearchParams(),
    [page, setPage] = useState(1)
  const base = `/organizations/${orgId}/projects/${projectId}/deliverables`,
    path = `${base}/${deliverableId}`,
    resource = useResource<DeliverableDetailDto>(`${path}?page=${page}`)
  const [feedback, setFeedback] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    pending = useRef(false)
  const data = resource.data,
    d = data?.deliverable,
    owner = user?.role === 'OWNER',
    paused = data && ['ON_HOLD', 'CANCELLED'].includes(data.project.status)
  const v =
      d?.versions.find(
        (v) => v.id === (search.get('version') ?? d.currentVersionId),
      ) ?? (!search.get('version') ? d?.versions[0] : undefined),
    current = d?.versions.find((v) => v.id === d.currentVersionId)
  async function action(value: string) {
    if (!d || pending.current) return
    if (
      value !== 'draft' &&
      !window.confirm(
        `${value === 'publish' ? 'Publish a version requiring fresh review' : label(value)}${v ? ` · version ${v.number}` : ''}?`,
      )
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (value === 'draft') {
        const r = await api<{ versionId: string }>(`${path}/versions`, 'POST', {
          expectedRevision: d.revision,
        })
        navigate(`${path}/versions/${r.versionId}/edit`)
        return
      }
      if (!v) return
      if (value === 'publish')
        await api(`${path}/versions/${v.id}/publish`, 'POST', {
          expectedRevision: v.revision,
          expectedDeliverableRevision: d.revision,
          reason,
        })
      else if (value === 'withdraw')
        await api(`${path}/versions/${v.id}/withdraw`, 'POST', {
          expectedRevision: d.revision,
          reason,
        })
      else
        await api(`${path}/versions/${v.id}/decision`, 'POST', {
          outcome: value,
          feedback,
        })
      setFeedback('')
      setReason('')
      resource.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Link to={`/organizations/${orgId}/projects/${projectId}`}>
        ← Project overview
      </Link>
      <h1>Deliverable review</h1>
      <Failure error={resource.error || error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading deliverable…</p>
      ) : (
        d &&
        data && (
          <>
            <h2>{current?.title ?? v?.title}</h2>
            <p className={styles.notice}>
              Current acceptance: <strong>{label(d.acceptance)}</strong> ·{' '}
              {d.required ? 'Required' : 'Optional'} · Project:{' '}
              {label(data.project.status)}
            </p>
            {paused && (
              <p>
                Read access is available. Resume a held project before further
                reviews or changes; cancellation is terminal.
              </p>
            )}
            {owner && !paused && (
              <MetadataForm
                key={`metadata-${d.revision}`}
                deliverable={d}
                path={path}
                reload={resource.reload}
              />
            )}
            <section className={styles.panel}>
              <h2>Version history</h2>
              <div className={styles.actions}>
                {d.versions.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={v?.id === item.id}
                    onClick={() => setSearch({ version: item.id })}
                  >
                    Version {item.number} · {label(item.state)}
                    {item.id === d.currentVersionId ? ' · Current' : ''}
                    {item.decision ? ` · ${label(item.decision.outcome)}` : ''}
                  </button>
                ))}
              </div>
              {v ? (
                <>
                  <p className={styles.notice}>
                    Version {v.number} · {label(v.state)} ·{' '}
                    {v.state === 'DRAFT'
                      ? 'Owner-only draft'
                      : v.id === d.currentVersionId
                        ? 'Current version'
                        : 'Historical version'}
                  </p>
                  <h3>{v.title}</h3>
                  <p className={styles.prose}>{v.description}</p>
                  {v.publishedAt && (
                    <p>Published {time(v.publishedAt)} (Asia/Manila)</p>
                  )}
                  {v.publicationReason && (
                    <p className={styles.prose}>
                      Replacement reason: {v.publicationReason}
                    </p>
                  )}
                  <ExternalLinks links={v.links} />
                  {v.decision && (
                    <section aria-label="Deliverable decision receipt">
                      <h3>Decision receipt</h3>
                      <p>
                        {label(v.decision.outcome)} by {v.decision.actor.name} ·{' '}
                        {time(v.decision.createdAt)} (Asia/Manila)
                      </p>
                      {v.decision.feedback && (
                        <p className={styles.prose}>
                          Feedback: {v.decision.feedback}
                        </p>
                      )}
                      <p>This receipt applies only to version {v.number}.</p>
                    </section>
                  )}
                  {owner && !paused && v.state === 'DRAFT' && (
                    <>
                      <Link to={`${path}/versions/${v.id}/edit`}>
                        Edit deliverable draft
                      </Link>
                      <label htmlFor="replacement-reason">
                        Publication reason (required when replacing an accepted
                        version)
                      </label>
                      <textarea
                        id="replacement-reason"
                        maxLength={2000}
                        disabled={busy}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <button
                        disabled={
                          busy ||
                          (current?.decision?.outcome === 'ACCEPTED' &&
                            !reason.trim())
                        }
                        onClick={() => void action('publish')}
                      >
                        Publish deliverable version
                      </button>
                      <p>
                        Publishing replaces the current version and requires
                        fresh client acceptance.
                      </p>
                    </>
                  )}
                  {owner &&
                    !paused &&
                    v.id === d.currentVersionId &&
                    v.state === 'PUBLISHED' &&
                    !v.decision && (
                      <>
                        <label htmlFor="withdrawal-reason">
                          Withdrawal reason
                        </label>
                        <textarea
                          id="withdrawal-reason"
                          maxLength={2000}
                          disabled={busy}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button
                          disabled={busy || !reason.trim()}
                          onClick={() => void action('withdraw')}
                        >
                          Withdraw pending version
                        </button>
                      </>
                    )}
                  {!owner &&
                    !paused &&
                    v.id === d.currentVersionId &&
                    v.state === 'PUBLISHED' &&
                    !v.decision && (
                      <>
                        <label htmlFor="deliverable-feedback">
                          Review feedback (required to request changes)
                        </label>
                        <textarea
                          id="deliverable-feedback"
                          maxLength={4000}
                          disabled={busy}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <div className={styles.actions}>
                          <button
                            disabled={busy}
                            onClick={() => void action('ACCEPTED')}
                          >
                            {busy ? 'Recording…' : 'Accept deliverable version'}
                          </button>
                          <button
                            disabled={busy || !feedback.trim()}
                            onClick={() => void action('CHANGES_REQUESTED')}
                          >
                            Request deliverable changes
                          </button>
                        </div>
                      </>
                    )}
                </>
              ) : (
                <p role="alert">Version unavailable for this deliverable.</p>
              )}
              {owner &&
                !paused &&
                !d.versions.some((v) => v.state === 'DRAFT') && (
                  <button disabled={busy} onClick={() => void action('draft')}>
                    Create revision draft
                  </button>
                )}
            </section>
            <section className={styles.panel}>
              <h2>Deliverable activity</h2>
              <ol className={styles.recordList}>
                {d.events.map((e) => (
                  <li key={e.id}>
                    <strong>{label(e.kind)}</strong>
                    {e.versionNumber && ` · v${e.versionNumber}`} ·{' '}
                    {e.actor.name} · {time(e.createdAt)} (Asia/Manila)
                    {e.requiredAfter !== null && (
                      <p>
                        Required:{' '}
                        {e.requiredBefore === null
                          ? 'initial'
                          : String(e.requiredBefore)}{' '}
                        → {String(e.requiredAfter)}
                      </p>
                    )}
                    {e.reason && <p className={styles.prose}>{e.reason}</p>}
                  </li>
                ))}
              </ol>
              <div className={styles.actions}>
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous activity
                </button>
                <span>Page {page}</span>
                <button
                  disabled={!data.hasMoreEvents}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next activity
                </button>
              </div>
            </section>
          </>
        )
      )}
    </>
  )
}
function MetadataForm({
  deliverable: d,
  path,
  reload,
}: {
  deliverable: DeliverableDto
  path: string
  reload: () => void
}) {
  const [required, setRequired] = useState(d.required),
    [position, setPosition] = useState(d.position),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    pending = useRef(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(path, 'PATCH', {
        required,
        position,
        expectedRevision: d.revision,
      })
      reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <form className={styles.panel} onSubmit={(e) => void save(e)}>
      <h2>Deliverable settings</h2>
      <Failure error={error} reload={reload} />
      <fieldset disabled={busy} className={styles.editorFields}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required deliverable
        </label>
        <label htmlFor="deliverable-position">Display order</label>
        <input
          id="deliverable-position"
          type="number"
          min={1}
          max={100}
          required
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
        <p>
          Use an unused slot. Changes are visible to the client and recorded in
          history.
        </p>
        <button disabled={busy}>Save deliverable settings</button>
      </fieldset>
    </form>
  )
}
export function DeliverableEditor() {
  const { orgId, projectId, deliverableId, versionId } = useParams(),
    base = `/organizations/${orgId}/projects/${projectId}/deliverables`,
    path = `${base}/${deliverableId}`,
    resource = useResource<DeliverableDetailDto>(path)
  const v = resource.data?.deliverable.versions.find((v) => v.id === versionId)
  return (
    <>
      <Link to={`${path}?version=${versionId}`}>← Deliverable review</Link>
      <h1>Deliverable draft editor</h1>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading deliverable editor…</p>
      ) : (
        resource.data &&
        (v?.state === 'DRAFT' &&
        !['ON_HOLD', 'CANCELLED'].includes(resource.data.project.status) ? (
          <ContentForm
            key={v.id}
            base={base}
            deliverableId={deliverableId}
            version={v}
            reload={resource.reload}
          />
        ) : (
          <p role="alert">
            Editable draft unavailable. Published snapshots are locked;
            held/cancelled projects cannot change.
          </p>
        ))
      )}
    </>
  )
}
function ContentForm({
  base,
  reload,
  position = 1,
  deliverableId,
  version,
}: {
  base: string
  reload: () => void
  position?: number
  deliverableId?: string
  version?: DeliverableVersionDto
}) {
  const navigate = useNavigate(),
    pending = useRef(false),
    saved = useRef(false),
    [title, setTitle] = useState(version?.title ?? ''),
    [description, setDescription] = useState(version?.description ?? ''),
    [links, setLinks] = useState(
      () =>
        version?.links.map((link) => ({ ...link, key: crypto.randomUUID() })) ??
        [],
    ),
    [required, setRequired] = useState(true),
    [order, setOrder] = useState(position),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false)
  const blocker = useBlocker(() => dirty && !saved.current)
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty && !saved.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [dirty])
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    setError('')
    const content = {
        title,
        description,
        links: links.map(({ label, url }) => ({ label, url })),
      },
      parsed = version
        ? deliverableContentSchema.safeParse(content)
        : deliverableCreateSchema.safeParse({
            ...content,
            required,
            position: order,
          })
    if (!parsed.success) {
      setError(
        'Complete title/description and link labels. Use up to five HTTPS DNS links without credentials, local hosts, IP literals, whitespace or malformed escapes.',
      )
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const result = await api<{ deliverableId?: string; versionId: string }>(
        version ? `${base}/${deliverableId}/versions/${version.id}` : base,
        version ? 'PATCH' : 'POST',
        {
          ...parsed.data,
          ...(version ? { expectedRevision: version.revision } : {}),
        },
      )
      saved.current = true
      setDirty(false)
      navigate(
        `${base}/${deliverableId ?? result.deliverableId}?version=${result.versionId}`,
      )
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      {blocker.state === 'blocked' && (
        <section role="alert" className={styles.notice}>
          <p>Unsaved deliverable draft changes.</p>
          <button autoFocus onClick={() => blocker.reset()}>
            Keep editing
          </button>
          <button onClick={() => blocker.proceed()}>
            Discard changes and leave
          </button>
        </section>
      )}
      <form
        className={styles.panel}
        onSubmit={(e) => void save(e)}
        onChange={() => setDirty(true)}
      >
        <h2>
          {version
            ? `Edit owner draft v${version.number}`
            : 'New deliverable draft'}
        </h2>
        <p>
          Text and optional external links only. Saving does not publish or
          replace the current version.
        </p>
        <Failure error={error} reload={reload} />
        <fieldset disabled={busy} className={styles.editorFields}>
          <label htmlFor="deliverable-title">Deliverable title</label>
          <input
            id="deliverable-title"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label htmlFor="deliverable-description">
            Deliverable description
          </label>
          <textarea
            id="deliverable-description"
            required
            maxLength={8000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {!version && (
            <>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                Required deliverable
              </label>
              <label htmlFor="new-deliverable-order">
                Deliverable display order
              </label>
              <input
                id="new-deliverable-order"
                type="number"
                min={1}
                max={100}
                required
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
              />
            </>
          )}
          <h3>Optional external links</h3>
          <p>
            Provider-controlled access; portal authorization does not make
            linked files private. Use public fictional resources for demos.
          </p>
          {links.map((link, i) => (
            <fieldset key={link.key} className={styles.itemEditor}>
              <legend>Link {i + 1}</legend>
              <label htmlFor={`link-label-${link.key}`}>
                Link {i + 1} label
              </label>
              <input
                id={`link-label-${link.key}`}
                required
                maxLength={120}
                value={link.label}
                onChange={(e) =>
                  setLinks((rows) =>
                    rows.map((r) =>
                      r.key === link.key ? { ...r, label: e.target.value } : r,
                    ),
                  )
                }
              />
              <label htmlFor={`link-url-${link.key}`}>
                Link {i + 1} HTTPS URL
              </label>
              <input
                id={`link-url-${link.key}`}
                required
                type="url"
                maxLength={1000}
                value={link.url}
                onChange={(e) =>
                  setLinks((rows) =>
                    rows.map((r) =>
                      r.key === link.key ? { ...r, url: e.target.value } : r,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() => {
                  setLinks((rows) => rows.filter((r) => r.key !== link.key))
                  setDirty(true)
                }}
              >
                Remove link {i + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={links.length >= 5}
            onClick={() => {
              setLinks((rows) => [
                ...rows,
                { key: crypto.randomUUID(), label: '', url: '' },
              ])
              setDirty(true)
            }}
          >
            Add external link
          </button>
          <button className={styles.submit} disabled={busy}>
            {busy
              ? 'Saving…'
              : version
                ? 'Save deliverable draft'
                : 'Create deliverable draft'}
          </button>
        </fieldset>
      </form>
    </>
  )
}
