import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  type HandoverDto,
  type HandoverItemDto,
  type HandoverItemInput,
  handoverItemSchema,
} from '@jcb/contracts'
import { useSession } from './session.js'
import { useResource } from './useResource.js'
import { api, errorMessage } from './api.js'
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
      {error}{' '}
      <button type="button" onClick={reload}>
        Reload handover
      </button>
    </p>
  ) : null
}
export function Handover() {
  const { orgId, projectId } = useParams(),
    { user } = useSession(),
    base = `/organizations/${orgId}/projects/${projectId}`,
    [page, setPage] = useState(1),
    resource = useResource<HandoverDto>(`${base}/handover?page=${page}`)
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    pending = useRef(false)
  const data = resource.data,
    loading = resource.loading,
    reload = resource.reload,
    owner = user?.role === 'OWNER',
    paused =
      data &&
      ['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(data.project.status)
  async function action(action: 'complete' | 'reopen') {
    if (
      !data ||
      pending.current ||
      !window.confirm(
        action === 'complete'
          ? 'Record project workflow completion using current authoritative readiness?'
          : 'Reopen the project to In review?',
      )
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(`${base}/${action}`, 'POST', {
        expectedRevision: data.project.revision,
        ...(action === 'complete' ? { confirm: true } : { reason }),
      })
      setReason('')
      reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Link to={base}>← Project overview</Link>
      <h1>Handover and completion</h1>
      <p>
        Completion records workflow closure, not payment, legal certification or
        independent verification of external links. Do not put passwords,
        tokens, credentials or other secrets in checklist text.
      </p>
      <Failure error={resource.error || error} reload={reload} />
      {loading ? (
        <p role="status">Loading handover…</p>
      ) : (
        data && (
          <>
            <p className={styles.notice}>
              Project: <strong>{label(data.project.status)}</strong>
            </p>
            <section className={styles.panel} aria-label="Completion readiness">
              <h2>Completion readiness</h2>
              <p>
                Readiness is advisory. Completion rechecks all authoritative
                records in one transaction.
              </p>
              {data.ready ? (
                <p role="status">Ready for owner confirmation.</p>
              ) : (
                <>
                  <p>
                    {data.project.status === 'COMPLETED'
                      ? 'Project is closed. Reopen explicitly before making workflow changes.'
                      : 'Completion is blocked:'}
                  </p>
                  <ul className={styles.recordList}>
                    {data.blockers.map((b, i) => (
                      <li key={`${b.code}-${i}`}>
                        <Link to={b.path}>{b.message}</Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {owner && data.project.status !== 'COMPLETED' && (
                <button
                  disabled={busy || !data.ready}
                  onClick={() => void action('complete')}
                >
                  {busy ? 'Recording…' : 'Confirm project completion'}
                </button>
              )}
              {owner && data.project.status === 'COMPLETED' && (
                <>
                  <label htmlFor="reopen-project-reason">
                    Project reopening reason (client-visible)
                  </label>
                  <textarea
                    id="reopen-project-reason"
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={() => void action('reopen')}
                  >
                    Reopen project to in review
                  </button>
                </>
              )}
              {!owner && (
                <p>
                  Only the owner can complete/reopen the project or manage
                  checklist tasks.
                </p>
              )}
            </section>
            <section>
              <h2>Handover checklist</h2>
              {!data.items.length && (
                <p>No client-visible handover items yet.</p>
              )}
              {data.items.map((item) => (
                <ChecklistItem
                  key={`${item.id}-${item.revision}`}
                  item={item}
                  base={base}
                  editable={owner && !paused}
                  reload={reload}
                />
              ))}
              {owner && !paused && data.items.length < 100 && (
                <ItemForm
                  base={base}
                  position={
                    Array.from({ length: 100 }, (_, i) => i + 1).find(
                      (p) => !data.items.some((i) => i.position === p),
                    ) ?? 1
                  }
                  reload={reload}
                />
              )}
              {paused && (
                <p>
                  Workflow is read-only while on hold, cancelled or completed.
                </p>
              )}
            </section>
            <section className={styles.panel}>
              <h2>Completion history</h2>
              {!data.completions.length && <p>No completion recorded yet.</p>}
              {data.completions.map((c) => (
                <article key={c.id}>
                  <h3>Completion cycle {c.cycle}</h3>
                  <p>
                    Recorded by {c.actor.name} · {time(c.completedAt)}{' '}
                    (Asia/Manila)
                  </p>
                  <details>
                    <summary>View immutable completion snapshot</summary>
                    <h4>Milestone review references</h4>
                    <ul>
                      {c.snapshot.milestones.map((m) => (
                        <li key={m.id}>
                          <Link to={`${base}/milestones/${m.id}`}>
                            {m.title}
                          </Link>{' '}
                          · {m.required ? 'Required' : 'Optional'} ·{' '}
                          {label(m.status)} · round {m.round ?? 'none'}
                        </li>
                      ))}
                    </ul>
                    <h4>Deliverable acceptance references</h4>
                    <ul>
                      {c.snapshot.deliverables.map((d) => (
                        <li key={d.id}>
                          <Link
                            to={`${base}/deliverables/${d.id}?version=${d.versionId ?? ''}`}
                          >
                            {d.title}
                          </Link>{' '}
                          · {d.required ? 'Required' : 'Optional'} · version{' '}
                          {d.number ?? 'none'} ·{' '}
                          {d.outcome ? label(d.outcome) : 'not accepted'}
                        </li>
                      ))}
                    </ul>
                    <h4>Change state at closure</h4>
                    <ul>
                      {c.snapshot.changes.map((r) => (
                        <li key={r.id}>
                          <Link to={`${base}/changes/${r.id}`}>{r.title}</Link>{' '}
                          · {label(r.state)}
                          {r.implementationNote && (
                            <p className={styles.prose}>
                              {r.implementationNote}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    <h4>Checklist state at closure</h4>
                    <ul>
                      {c.snapshot.checklist.map((i) => (
                        <li key={i.id}>
                          {i.title} · {i.required ? 'Required' : 'Optional'} ·{' '}
                          {i.completedAt
                            ? `Completed by ${i.completer?.name ?? 'owner'} · ${time(i.completedAt)}`
                            : 'Incomplete'}
                          <p className={styles.prose}>{i.description}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              ))}
            </section>
            <section className={styles.panel}>
              <h2>Handover activity</h2>
              <ol className={styles.recordList}>
                {data.events.map((e) => (
                  <li key={e.id}>
                    <strong>{label(e.kind)}</strong> · {e.actor.name} ·{' '}
                    {time(e.createdAt)} (Asia/Manila)
                    {e.reason && <p className={styles.prose}>{e.reason}</p>}
                    <details>
                      <summary>Recorded change</summary>
                      <AuditDetails details={e.details} />
                    </details>
                  </li>
                ))}
              </ol>
              <div className={styles.actions}>
                <button
                  disabled={page === 1 || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous handover activity
                </button>
                <span>Page {page}</span>
                <button
                  disabled={!data.hasMoreEvents || busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next handover activity
                </button>
              </div>
            </section>
          </>
        )
      )}
    </>
  )
}
function ChecklistItem({
  item,
  base,
  editable,
  reload,
}: {
  item: HandoverItemDto
  base: string
  editable: boolean
  reload: () => void
}) {
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    pending = useRef(false)
  async function check() {
    if (pending.current || !reason.trim()) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(`${base}/handover/items/${item.id}/check`, 'POST', {
        completed: !item.completedAt,
        expectedRevision: item.revision,
        reason,
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
    <article className={styles.panel}>
      <h3>
        {item.position}. {item.title}
      </h3>
      <p className={styles.prose}>{item.description}</p>
      <p>
        {item.required ? 'Required' : 'Optional'} ·{' '}
        {item.clientVisible ? 'Client-visible' : 'Owner-only'} ·{' '}
        {item.completedAt
          ? `Completed by ${item.completer?.name ?? 'owner'} · ${time(item.completedAt)} (Asia/Manila)`
          : 'Incomplete'}
      </p>
      {editable && (
        <>
          <Failure error={error} reload={reload} />
          <label htmlFor={`check-${item.id}`}>Task action reason</label>
          <textarea
            id={`check-${item.id}`}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
          <div className={styles.actions}>
            <button
              disabled={busy || !reason.trim()}
              onClick={() => void check()}
            >
              {item.completedAt ? 'Uncheck task' : 'Mark task complete'}
            </button>
            <button disabled={busy} onClick={() => setEditing((v) => !v)}>
              {editing ? 'Keep current task' : 'Edit checklist item'}
            </button>
          </div>
          {editing && <ItemForm base={base} item={item} reload={reload} />}
        </>
      )}
    </article>
  )
}
function ItemForm({
  base,
  item,
  position = 1,
  reload,
}: {
  base: string
  item?: HandoverItemDto
  position?: number
  reload: () => void
}) {
  const [value, setValue] = useState<HandoverItemInput>(() =>
      item
        ? {
            title: item.title,
            description: item.description,
            required: item.required,
            clientVisible: item.clientVisible,
            position: item.position,
          }
        : {
            title: '',
            description: '',
            required: true,
            clientVisible: true,
            position,
          },
    ),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    pending = useRef(false)
  const prefix = item?.id ?? 'new-checklist'
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    const parsed = handoverItemSchema.safeParse(value)
    if (!parsed.success) {
      setError(
        'Complete the title and description and choose an unused order slot from 1–100.',
      )
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(
        `${base}/handover/items${item ? '/' + item.id : ''}`,
        item ? 'PATCH' : 'POST',
        {
          ...parsed.data,
          ...(item ? { expectedRevision: item.revision, reason } : {}),
        },
      )
      if (!item) setValue({ ...value, title: '', description: '' })
      reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <form className={styles.panel} onSubmit={(e) => void submit(e)}>
      <h3>{item ? 'Edit handover task' : 'New handover task'}</h3>
      <p>
        Text only; never store passwords or secrets. Editing an item clears its
        completion and records before/after state. Required-flag changes need an
        explicit reason.
      </p>
      <Failure error={error} reload={reload} />
      <fieldset disabled={busy} className={styles.editorFields}>
        <label htmlFor={`${prefix}-title`}>Checklist title</label>
        <input
          id={`${prefix}-title`}
          value={value.title}
          required
          maxLength={120}
          onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
        />
        <label htmlFor={`${prefix}-description`}>Checklist description</label>
        <textarea
          id={`${prefix}-description`}
          value={value.description}
          required
          maxLength={4000}
          onChange={(e) =>
            setValue((v) => ({ ...v, description: e.target.value }))
          }
        />
        <label htmlFor={`${prefix}-order`}>Checklist display order</label>
        <input
          id={`${prefix}-order`}
          type="number"
          min={1}
          max={100}
          required
          value={value.position}
          onChange={(e) =>
            setValue((v) => ({ ...v, position: Number(e.target.value) }))
          }
        />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={value.required}
            onChange={(e) =>
              setValue((v) => ({ ...v, required: e.target.checked }))
            }
          />
          Required checklist item
        </label>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={value.clientVisible}
            onChange={(e) =>
              setValue((v) => ({ ...v, clientVisible: e.target.checked }))
            }
          />
          Visible to clients
        </label>
        {item && (
          <>
            <label htmlFor={`${prefix}-reason`}>Checklist edit reason</label>
            <textarea
              id={`${prefix}-reason`}
              value={reason}
              required
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        )}
        <button disabled={busy}>
          {busy
            ? 'Saving…'
            : item
              ? 'Save checklist changes'
              : 'Create handover task'}
        </button>
      </fieldset>
    </form>
  )
}

function AuditDetails({ details }: { details: Record<string, unknown> }) {
  return (
    <dl>
      {Object.entries(details).map(([key, value]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>
            {value !== null && typeof value === 'object' ? (
              <ul>
                {Object.entries(value)
                  .filter(([k]) =>
                    [
                      'title',
                      'description',
                      'required',
                      'clientVisible',
                      'position',
                      'completedAt',
                    ].includes(k),
                  )
                  .map(([k, v]) => (
                    <li key={k}>
                      {label(k)}:{' '}
                      {v === null
                        ? 'Not complete'
                        : typeof v === 'boolean'
                          ? v
                            ? 'Yes'
                            : 'No'
                          : String(v)}
                    </li>
                  ))}
              </ul>
            ) : typeof value === 'boolean' ? (
              value ? (
                'Required'
              ) : (
                'Optional'
              )
            ) : (
              String(value ?? 'None')
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
