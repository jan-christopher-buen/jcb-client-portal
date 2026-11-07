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
    resource = useResource<HandoverDto>(`${base}/handover?page=${page}`, {
      retainDataOnReload: user?.role === 'OWNER',
      retentionKey: base,
    })
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
      loading ||
      !!resource.error ||
      !owner ||
      (action === 'complete'
        ? paused || !data.ready || data.project.status !== 'IN_REVIEW'
        : data.project.status !== 'COMPLETED' || !reason.trim()) ||
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
      {loading && (
        <p role="status">Loading handover… Local input is retained.</p>
      )}
      {data && (
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
                disabled={
                  busy ||
                  loading ||
                  !!resource.error ||
                  !!paused ||
                  !data.ready ||
                  data.project.status !== 'IN_REVIEW'
                }
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
                  disabled={
                    busy || loading || !!resource.error || !reason.trim()
                  }
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
            {!data.items.length && <p>No client-visible handover items yet.</p>}
            {data.items.map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                base={base}
                owner={owner}
                unavailable={
                  loading
                    ? 'Refreshing handover. Saving is disabled.'
                    : resource.error
                      ? 'The latest handover state could not be verified. Reload before saving.'
                      : paused
                        ? `This project is ${label(data.project.status)}. Workflow changes are unavailable.`
                        : busy
                          ? 'A project action is pending.'
                          : ''
                }
                snapshot={data}
                reload={reload}
              />
            ))}
            {owner && (
              <ItemForm
                key={`new-${base}`}
                base={base}
                snapshot={data}
                unavailable={
                  loading
                    ? 'Refreshing handover. Saving is disabled.'
                    : resource.error
                      ? 'The latest handover state could not be verified. Reload before saving.'
                      : paused
                        ? `This project is ${label(data.project.status)}. Workflow changes are unavailable.`
                        : busy
                          ? 'A project action is pending.'
                          : data.items.length >= 100
                            ? 'The project already has 100 checklist tasks.'
                            : ''
                }
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
                        <Link to={`${base}/milestones/${m.id}`}>{m.title}</Link>{' '}
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
                        <Link to={`${base}/changes/${r.id}`}>{r.title}</Link> ·{' '}
                        {label(r.state)}
                        {r.implementationNote && (
                          <p className={styles.prose}>{r.implementationNote}</p>
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
      )}
    </>
  )
}
function ChecklistItem({
  item,
  base,
  owner,
  reload,
  unavailable,
  snapshot,
}: {
  item: HandoverItemDto
  base: string
  owner: boolean
  reload: () => void
  unavailable: string
  snapshot: HandoverDto
}) {
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(item.revision),
    [failedSnapshot, setFailedSnapshot] = useState<HandoverDto | null>(null),
    pending = useRef(false)
  const reviewRequired = !!failedSnapshot || item.revision !== revision
  const canReview =
    !unavailable && (!failedSnapshot || snapshot !== failedSnapshot)
  async function check() {
    if (
      pending.current ||
      !owner ||
      unavailable ||
      reviewRequired ||
      !reason.trim()
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(`${base}/handover/items/${item.id}/check`, 'POST', {
        completed: !item.completedAt,
        expectedRevision: revision,
        reason,
      })
      setRevision(revision + 1)
      setReason('')
      setFailedSnapshot(null)
      reload()
    } catch (e) {
      setFailedSnapshot(snapshot)
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
      {owner && (
        <>
          <Failure error={error} reload={reload} />
          {unavailable && (
            <p role="alert">{unavailable} Local input is retained.</p>
          )}
          {reviewRequired && reason && (
            <section
              aria-label="Review latest task action"
              className={styles.notice}
            >
              <p>
                Review task revision {item.revision}: {item.title}. Current
                state: {item.completedAt ? 'Complete' : 'Incomplete'}. Your
                action reason is retained.
              </p>
              <button
                type="button"
                disabled={busy || !canReview}
                onClick={() => {
                  setRevision(item.revision)
                  setFailedSnapshot(null)
                  setError('')
                }}
              >
                Use latest task state for check action
              </button>
            </section>
          )}
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
              disabled={
                busy || !!unavailable || reviewRequired || !reason.trim()
              }
              onClick={() => void check()}
            >
              {item.completedAt ? 'Uncheck task' : 'Mark task complete'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit checklist item
            </button>
          </div>
          <div hidden={!editing}>
            <ItemForm
              base={base}
              item={item}
              reload={reload}
              snapshot={snapshot}
              unavailable={unavailable}
              onClose={() => setEditing(false)}
            />
          </div>
        </>
      )}
    </article>
  )
}
function taskValues(
  item: HandoverItemDto | undefined,
  position: number,
): HandoverItemInput {
  return item
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
      }
}
function ItemForm({
  base,
  item,
  position = 1,
  reload,
  snapshot,
  unavailable,
  onClose,
}: {
  base: string
  item?: HandoverItemDto
  position?: number
  reload: () => void
  snapshot: HandoverDto
  unavailable: string
  onClose?: () => void
}) {
  const [value, setValue] = useState<HandoverItemInput>(() =>
      taskValues(item, position),
    ),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState(item?.revision),
    [failedSnapshot, setFailedSnapshot] = useState<HandoverDto | null>(null),
    pending = useRef(false)
  const prefix = item?.id ?? 'new-checklist'
  const reviewRequired =
    !!failedSnapshot || (!!item && item.revision !== revision)
  const canReview =
    !unavailable && (!failedSnapshot || snapshot !== failedSnapshot)
  const occupied = snapshot.items.some(
    (row) => row.id !== item?.id && row.position === value.position,
  )
  const blocked = busy || !!unavailable || reviewRequired || occupied
  function reconcile(discard: boolean, close = false) {
    if (!canReview || pending.current) return
    if (discard) {
      if (
        dirty &&
        !window.confirm(
          'Discard local checklist fields and edit reason and use the latest task values?',
        )
      )
        return
      setValue(taskValues(item, position))
      setReason('')
      setDirty(false)
    }
    setRevision(item?.revision)
    setFailedSnapshot(null)
    setError('')
    if (close) onClose?.()
  }
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending.current || blocked) return
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
          ...(item ? { expectedRevision: revision, reason } : {}),
        },
      )
      if (item) {
        setValue(parsed.data)
        setRevision(revision! + 1)
      } else {
        const next =
          Array.from({ length: 100 }, (_, i) => i + 1).find(
            (slot) =>
              slot !== parsed.data.position &&
              !snapshot.items.some((row) => row.position === slot),
          ) ?? 1
        setValue(taskValues(undefined, next))
      }
      setReason('')
      setDirty(false)
      setFailedSnapshot(null)
      reload()
    } catch (e) {
      setFailedSnapshot(snapshot)
      setError(errorMessage(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className={styles.panel}
      onSubmit={(e) => void submit(e)}
      onChange={() => setDirty(true)}
    >
      <h3>{item ? 'Edit handover task' : 'New handover task'}</h3>
      <p>
        Text only; never store passwords or secrets. Editing an item clears its
        completion and records before/after state. Required-flag changes need an
        explicit reason.
      </p>
      <Failure error={error} reload={reload} />
      {unavailable && (
        <p role="alert">{unavailable} Local input is retained.</p>
      )}
      {occupied && (
        <p role="alert">
          That display order is occupied. Choose an unused slot.
        </p>
      )}
      {reviewRequired && (
        <section
          className={styles.notice}
          aria-label="Review latest checklist task"
        >
          <h4>Compare latest checklist state before retrying</h4>
          <p>
            Local fields and reasons have not been replaced. Keeping edits
            intentionally replaces the displayed server fields on the next save.
          </p>
          {canReview ? (
            <>
              {item ? (
                <>
                  <p>Latest task revision: {item.revision}</p>
                  <p>Latest title: {item.title}</p>
                  <p>Latest description: {item.description}</p>
                  <p>
                    Required: {String(item.required)} · Client-visible:{' '}
                    {String(item.clientVisible)} · Order: {item.position} ·{' '}
                    {item.completedAt ? 'Complete' : 'Incomplete'}
                  </p>
                </>
              ) : (
                <p>
                  Occupied orders:{' '}
                  {snapshot.items.map((row) => row.position).join(', ') ||
                    'None'}
                  . Choose a free slot.
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => reconcile(false)}
              >
                {item
                  ? `Keep checklist edits against revision ${item.revision}`
                  : 'Keep new task edits'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => reconcile(true)}
              >
                Discard checklist edits and use latest
              </button>
            </>
          ) : (
            <p>Refresh successfully before reviewing writable state.</p>
          )}
        </section>
      )}
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
        <button disabled={blocked}>
          {busy
            ? 'Saving…'
            : item
              ? 'Save checklist changes'
              : 'Create handover task'}
        </button>
      </fieldset>
      {onClose && (
        <button
          type="button"
          disabled={busy || !canReview}
          onClick={() => reconcile(true, true)}
        >
          Close task editor
        </button>
      )}
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
