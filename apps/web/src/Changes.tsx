import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Link,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import {
  formatPhp,
  formatSignedPhp,
  phpAdjustmentToMinor,
  changeOfferSchema,
  changeRequestSchema,
  type AgreedAmounts,
  type ChangeDetailDto,
  type ChangeListDto,
  type ChangeOfferDto,
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
export function Agreement({
  amounts,
  base,
}: {
  amounts: AgreedAmounts
  base: string
}) {
  return (
    <section className={styles.panel} aria-label="Agreed scope amounts">
      <h2>Agreed scope amounts · PHP</h2>
      <dl>
        <dt>Original approved proposal</dt>
        <dd>{formatPhp(amounts.originalMinor)}</dd>
        <dt>Approved change adjustments</dt>
        <dd>{formatSignedPhp(amounts.adjustmentsMinor)}</dd>
        <dt>Revised agreed amount</dt>
        <dd>
          <strong>{formatPhp(amounts.revisedMinor)}</strong>
        </dd>
      </dl>
      {!amounts.approvedChanges.length ? (
        <p>No approved changes yet.</p>
      ) : (
        <ul>
          {amounts.approvedChanges.map((c) => (
            <li key={c.offerId}>
              <Link to={`${base}/${c.requestId}?offer=${c.offerId}`}>
                {c.title} · offer v{c.number}
              </Link>{' '}
              · {formatSignedPhp(c.adjustmentMinor)}
            </li>
          ))}
        </ul>
      )}
      <p>
        Pending, declined and superseded offers do not affect these amounts.
        This records agreed scope, not invoices, payments or refunds.
      </p>
    </section>
  )
}
export function ProjectChanges() {
  const { orgId, projectId } = useParams(),
    base = `/organizations/${orgId}/projects/${projectId}/changes`
  const resource = useResource<ChangeListDto>(base)
  return (
    <>
      <Link className={styles.actionLink} to={base}>
        Change requests and offers
      </Link>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading agreed amounts…</p>
      ) : (
        resource.data && (
          <Agreement amounts={resource.data.amounts} base={base} />
        )
      )}
    </>
  )
}
export function ChangeList() {
  const { orgId, projectId } = useParams(),
    { user } = useSession(),
    navigate = useNavigate(),
    base = `/organizations/${orgId}/projects/${projectId}/changes`
  const [page, setPage] = useState(1),
    resource = useResource<ChangeListDto>(`${base}?page=${page}`)
  const [title, setTitle] = useState(''),
    [requested, setRequested] = useState(''),
    [context, setContext] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    pending = useRef(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    setError('')
    const data = changeRequestSchema.safeParse({
      title,
      requestedChange: requested,
      businessContext: context,
    })
    if (!data.success) {
      setError('Complete the title, requested change and business context.')
      return
    }
    pending.current = true
    setBusy(true)
    try {
      const r = await api<{ requestId: string }>(base, 'POST', data.data)
      navigate(`${base}/${r.requestId}`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const paused =
    resource.data?.project.status === 'ON_HOLD' ||
    resource.data?.project.status === 'CANCELLED'
  return (
    <>
      <Link to={`/organizations/${orgId}/projects/${projectId}`}>
        ← Project overview
      </Link>
      <h1>Change requests</h1>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading change requests…</p>
      ) : (
        resource.data && (
          <>
            <p>
              Status: {label(resource.data.project.status)}.{' '}
              {paused &&
                'Workflow changes are unavailable while this project is on hold or cancelled.'}
            </p>
            <Agreement amounts={resource.data.amounts} base={base} />
            <section className={styles.panel}>
              <h2>Requests</h2>
              {!resource.data.requests.length && <p>No change requests yet.</p>}
              <ul className={styles.recordList}>
                {resource.data.requests.map((r) => (
                  <li key={r.id}>
                    <Link to={`${base}/${r.id}`}>{r.title}</Link>
                    <p>
                      {label(r.state)} · {time(r.createdAt)} (Asia/Manila)
                    </p>
                  </li>
                ))}
              </ul>
              <div className={styles.actions}>
                <button
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous requests
                </button>
                <span>Page {page}</span>
                <button
                  disabled={!resource.data.hasMore}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next requests
                </button>
              </div>
            </section>
            {user?.role === 'CLIENT' && !paused && (
              <form className={styles.panel} onSubmit={(e) => void submit(e)}>
                <h2>Request a scope change</h2>
                <Failure error={error} reload={resource.reload} />
                <fieldset disabled={busy} className={styles.editorFields}>
                  <label htmlFor="change-title">Request title</label>
                  <input
                    id="change-title"
                    required
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <label htmlFor="change-requested">Requested change</label>
                  <textarea
                    id="change-requested"
                    required
                    maxLength={8000}
                    value={requested}
                    onChange={(e) => setRequested(e.target.value)}
                  />
                  <label htmlFor="change-context">Business context</label>
                  <textarea
                    id="change-context"
                    required
                    maxLength={4000}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                  <button className={styles.submit} disabled={busy}>
                    {busy ? 'Creating…' : 'Create change request'}
                  </button>
                </fieldset>
              </form>
            )}
          </>
        )
      )}
    </>
  )
}
export function ChangeDetail() {
  const { orgId, projectId, requestId } = useParams(),
    { user } = useSession(),
    navigate = useNavigate(),
    [search, setSearch] = useSearchParams()
  const base = `/organizations/${orgId}/projects/${projectId}/changes`,
    path = `${base}/${requestId}`,
    resource = useResource<ChangeDetailDto>(path)
  const [body, setBody] = useState(''),
    [kind, setKind] = useState('CLARIFICATION'),
    [note, setNote] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    pending = useRef(false)
  const data = resource.data,
    r = data?.request,
    owner = user?.role === 'OWNER',
    paused =
      data?.project.status === 'ON_HOLD' || data?.project.status === 'CANCELLED'
  const selected =
    r?.offers.find(
      (o) => o.id === (search.get('offer') ?? r.publishedOfferId),
    ) ?? (!search.get('offer') ? r?.offers[0] : undefined)
  async function action(action: string) {
    if (!r || pending.current) return
    if (
      ['publish', 'APPROVED', 'DECLINED', 'implement'].includes(action) &&
      !window.confirm(
        `${action === 'implement' ? 'Record implementation (not client acceptance)' : label(action)}${selected ? ` · offer v${selected.number}` : ''}?`,
      )
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'draft') {
        const result = await api<{ offerId: string }>(
          `${path}/offers`,
          'POST',
          { expectedRevision: r.revision },
        )
        navigate(`${path}/offers/${result.offerId}/edit`)
        return
      }
      if (action === 'message') {
        await api(`${path}/messages`, 'POST', {
          kind: owner ? kind : 'RESPONSE',
          body,
          expectedRevision: r.revision,
        })
        setBody('')
      } else if (action === 'implement') {
        await api(`${path}/implement`, 'POST', {
          note,
          expectedRevision: r.revision,
        })
        setNote('')
      } else if (selected)
        await api(
          `${path}/offers/${selected.id}/${action === 'publish' ? 'publish' : 'decision'}`,
          'POST',
          action === 'publish'
            ? { expectedRevision: selected.revision }
            : { outcome: action },
        )
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
      <Link to={base}>← Change requests</Link>
      <h1>Change request review</h1>
      <Failure error={resource.error || error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading change request…</p>
      ) : (
        r &&
        data && (
          <>
            <h2>{r.title}</h2>
            <p className={styles.notice}>
              Request: {label(r.state)} · Project: {label(data.project.status)}
            </p>
            <p>
              Requested by {r.creator.name} · {time(r.createdAt)} (Asia/Manila)
            </p>
            <h3>Requested change</h3>
            <p className={styles.prose}>{r.requestedChange}</p>
            <h3>Business context</h3>
            <p className={styles.prose}>{r.businessContext}</p>
            <Agreement amounts={data.amounts} base={base} />
            {paused && (
              <p className={styles.notice}>
                Read access is available. Resume a held project before further
                workflow changes; cancelled projects cannot resume.
              </p>
            )}
            <section className={styles.panel}>
              <h2>Discussion history</h2>
              {!r.messages.length && <p>No discussion yet.</p>}
              <ol className={styles.recordList}>
                {r.messages.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.kind === 'OWNER_NOTE'
                        ? 'Owner-only note'
                        : label(m.kind)}
                    </strong>{' '}
                    · {m.actor.name} · {time(m.createdAt)} (Asia/Manila)
                    <p className={styles.prose}>{m.body}</p>
                  </li>
                ))}
              </ol>
              {!paused && (owner || r.state === 'NEEDS_CLARIFICATION') && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void action('message')
                  }}
                >
                  <fieldset disabled={busy} className={styles.editorFields}>
                    {owner && (
                      <>
                        <label htmlFor="message-kind">
                          Discussion visibility/action
                        </label>
                        <select
                          id="message-kind"
                          value={kind}
                          onChange={(e) => setKind(e.target.value)}
                        >
                          <option
                            value="CLARIFICATION"
                            disabled={
                              ![
                                'OPEN',
                                'NEEDS_CLARIFICATION',
                                'DECLINED',
                              ].includes(r.state)
                            }
                          >
                            Request client clarification
                          </option>
                          <option value="OWNER_NOTE">Owner-only note</option>
                        </select>
                      </>
                    )}
                    <label htmlFor="change-message">
                      {owner
                        ? 'Message or owner-only note'
                        : 'Clarification response'}
                    </label>
                    <textarea
                      id="change-message"
                      required
                      maxLength={4000}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                    <button
                      disabled={
                        busy ||
                        !body.trim() ||
                        (owner &&
                          kind === 'CLARIFICATION' &&
                          !['OPEN', 'NEEDS_CLARIFICATION', 'DECLINED'].includes(
                            r.state,
                          ))
                      }
                    >
                      Send{' '}
                      {owner && kind === 'OWNER_NOTE'
                        ? 'owner-only note'
                        : owner
                          ? 'clarification request'
                          : 'response'}
                    </button>
                  </fieldset>
                </form>
              )}
            </section>
            <section className={styles.panel}>
              <h2>Offer history</h2>
              {!r.offers.length && (
                <p>
                  No published offer yet. The owner prepares the scope and
                  adjustment.
                </p>
              )}
              <div className={styles.actions}>
                {r.offers.map((o) => (
                  <button
                    key={o.id}
                    aria-pressed={selected?.id === o.id}
                    onClick={() => setSearch({ offer: o.id })}
                  >
                    Offer v{o.number} · {label(o.state)}
                    {r.publishedOfferId === o.id ? ' · Current' : ''}
                  </button>
                ))}
              </div>
              {selected ? (
                <>
                  <p className={styles.notice}>
                    Offer v{selected.number} · {label(selected.state)} ·{' '}
                    {selected.state === 'DRAFT'
                      ? 'Owner-only draft'
                      : r.publishedOfferId === selected.id
                        ? 'Current published version'
                        : 'Historical version'}
                  </p>
                  <h3>Offered scope</h3>
                  <p className={styles.prose}>{selected.scope}</p>
                  <h3>Exclusions</h3>
                  <p className={styles.prose}>
                    {selected.exclusions || 'None stated.'}
                  </p>
                  <p>
                    Price adjustment:{' '}
                    <strong>{formatSignedPhp(selected.adjustmentMinor)}</strong>
                  </p>
                  <h3>Schedule impact</h3>
                  <p className={styles.prose}>{selected.scheduleImpact}</p>
                  <p>
                    Approval does not move project or milestone dates. Date
                    changes require a separate owner action.
                  </p>
                  {selected.decision && (
                    <section aria-label="Offer decision receipt">
                      <h3>Decision receipt</h3>
                      <p>
                        {label(selected.decision.outcome)} by{' '}
                        {selected.decision.actor.name} ·{' '}
                        {time(selected.decision.createdAt)} (Asia/Manila)
                      </p>
                    </section>
                  )}
                  {!paused &&
                    owner &&
                    selected.state === 'DRAFT' &&
                    !['APPROVED', 'IMPLEMENTED'].includes(r.state) && (
                      <div className={styles.actions}>
                        <Link to={`${path}/offers/${selected.id}/edit`}>
                          Edit offer draft
                        </Link>
                        <button
                          disabled={busy || r.state === 'NEEDS_CLARIFICATION'}
                          onClick={() => void action('publish')}
                        >
                          Publish offer
                        </button>
                      </div>
                    )}
                  {!paused &&
                    !owner &&
                    r.publishedOfferId === selected.id &&
                    selected.state === 'PUBLISHED' && (
                      <div className={styles.actions}>
                        <button
                          disabled={busy}
                          onClick={() => void action('APPROVED')}
                        >
                          {busy ? 'Recording…' : 'Approve offer'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void action('DECLINED')}
                        >
                          Decline offer
                        </button>
                      </div>
                    )}
                </>
              ) : (
                search.get('offer') && (
                  <p role="alert">Offer unavailable for this request.</p>
                )
              )}
              {owner &&
                !paused &&
                !['APPROVED', 'IMPLEMENTED'].includes(r.state) &&
                !r.offers.some((o) => o.state === 'DRAFT') && (
                  <button disabled={busy} onClick={() => void action('draft')}>
                    Create offer draft
                  </button>
                )}
            </section>
            {owner && !paused && r.state === 'APPROVED' && (
              <form
                className={styles.panel}
                onSubmit={(e) => {
                  e.preventDefault()
                  void action('implement')
                }}
              >
                <h2>Record implementation</h2>
                <p>
                  This records owner work, not client acceptance or project
                  completion.
                </p>
                <label htmlFor="implementation-note">
                  Implementation note (client-visible)
                </label>
                <textarea
                  id="implementation-note"
                  required
                  maxLength={2000}
                  disabled={busy}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button disabled={busy || !note.trim()}>
                  Mark implemented
                </button>
              </form>
            )}
            {r.state === 'IMPLEMENTED' && (
              <section className={styles.panel}>
                <h2>Implementation recorded</h2>
                <p>
                  {r.implementer?.name} · {time(r.implementedAt!)} (Asia/Manila)
                </p>
                <p className={styles.prose}>{r.implementationNote}</p>
                <p>
                  Owner-recorded work; this is not client acceptance or project
                  completion.
                </p>
              </section>
            )}
          </>
        )
      )}
    </>
  )
}
export function ChangeOfferEditor() {
  const { orgId, projectId, requestId, offerId } = useParams(),
    path = `/organizations/${orgId}/projects/${projectId}/changes/${requestId}`
  const resource = useResource<ChangeDetailDto>(path),
    offer = resource.data?.request.offers.find((o) => o.id === offerId)
  return (
    <>
      <Link to={`${path}?offer=${offerId}`}>← Change request review</Link>
      <h1>Offer editor</h1>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading offer editor…</p>
      ) : (
        resource.data &&
        (offer?.state === 'DRAFT' &&
        !['APPROVED', 'IMPLEMENTED'].includes(resource.data.request.state) &&
        !['ON_HOLD', 'CANCELLED'].includes(resource.data.project.status) ? (
          <OfferForm
            key={offer.id}
            offer={offer}
            path={path}
            reload={resource.reload}
          />
        ) : (
          <p role="alert">
            Editable offer unavailable. Published/approved offers are locked;
            held/cancelled projects cannot change.
          </p>
        ))
      )}
    </>
  )
}
function OfferForm({
  offer,
  path,
  reload,
}: {
  offer: ChangeOfferDto
  path: string
  reload: () => void
}) {
  const navigate = useNavigate(),
    pending = useRef(false),
    saved = useRef(false)
  const [scope, setScope] = useState(offer.scope),
    [exclusions, setExclusions] = useState(offer.exclusions),
    [schedule, setSchedule] = useState(offer.scheduleImpact),
    [price, setPrice] = useState(() => {
      const amount = BigInt(offer.adjustmentMinor),
        abs = amount < 0n ? -amount : amount
      return `${amount < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
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
    try {
      let adjustmentMinor: string
      try {
        adjustmentMinor = phpAdjustmentToMinor(price)
      } catch {
        setError(
          'Enter a signed PHP adjustment with up to two decimal places, without commas, within PHP 1,000,000,000,000,000.00 in either direction.',
        )
        return
      }
      const parsed = changeOfferSchema.safeParse({
        scope,
        exclusions,
        scheduleImpact: schedule,
        adjustmentMinor,
      })
      if (!parsed.success) {
        setError(
          'Complete the offered scope and explicit schedule impact within the field limits.',
        )
        return
      }
      const input = parsed.data
      pending.current = true
      setBusy(true)
      await api(`${path}/offers/${offer.id}`, 'PATCH', {
        ...input,
        expectedRevision: offer.revision,
      })
      saved.current = true
      setDirty(false)
      navigate(`${path}?offer=${offer.id}`)
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
          <p>Unsaved offer changes.</p>
          <button autoFocus onClick={() => blocker.reset()}>
            Keep editing
          </button>
          <button onClick={() => blocker.proceed()}>
            Discard changes and leave
          </button>
        </section>
      )}
      <p>
        Offer draft v{offer.number}. Saving does not publish or invalidate the
        current offer.
      </p>
      <Failure error={error} reload={reload} />
      <form
        className={styles.panel}
        onSubmit={(e) => void save(e)}
        onChange={() => setDirty(true)}
      >
        <fieldset disabled={busy} className={styles.editorFields}>
          <label htmlFor="offer-scope">Offered scope</label>
          <textarea
            id="offer-scope"
            required
            maxLength={8000}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
          <label htmlFor="offer-exclusions">Offer exclusions</label>
          <textarea
            id="offer-exclusions"
            maxLength={4000}
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
          />
          <label htmlFor="offer-price">Price adjustment (PHP)</label>
          <input
            id="offer-price"
            required
            inputMode="text"
            maxLength={20}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <p>
            Positive, zero or negative. Up to PHP 1,000,000,000,000,000.00 in
            either direction. Approval must keep the revised agreed amount
            within that range and at least zero.
          </p>
          <label htmlFor="offer-schedule">Schedule impact</label>
          <textarea
            id="offer-schedule"
            required
            maxLength={2000}
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
          <p>
            Describe the impact explicitly. Approval never shifts saved dates.
          </p>
          <button className={styles.submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save offer draft'}
          </button>
        </fieldset>
      </form>
    </>
  )
}
