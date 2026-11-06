import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  milestoneInputSchema,
  type ProjectDto,
  type WorkflowDto,
  type MilestoneDto,
  type MilestoneInput,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useSession } from './session.js'
import { useResource } from './useResource.js'
import { ProjectDeliverables } from './Deliverables.js'
import { ProjectChanges } from './Changes.js'
import { Snapshot } from './Proposals.js'
import styles from './App.module.css'
const label = (s: string) => s.toLowerCase().replaceAll('_', ' ')
const time = (s: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(s))
function useAction(reload: () => void) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function run(
    path: string,
    body: object,
    method: 'POST' | 'PATCH' = 'POST',
  ) {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await api(path, method, body)
      reload()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, error, run }
}
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
function nextAction(m: MilestoneDto, owner: boolean) {
  if (m.status === 'PLANNED') return 'Owner: start milestone'
  if (m.status === 'IN_PROGRESS')
    return 'Owner: prepare and submit text for review'
  if (m.status === 'IN_REVIEW')
    return owner
      ? 'Waiting for client review'
      : 'Review the current round and decide'
  return 'Accepted by client'
}
export function ProjectOverview() {
  const { orgId, projectId } = useParams(),
    { user } = useSession()
  const base = `/organizations/${orgId}/projects/${projectId}`
  const scope = useResource<{ project: ProjectDto }>(base)
  const [page, setPage] = useState(1)
  const resource = useResource<WorkflowDto>(`${base}/workflow?page=${page}`)
  const action = useAction(resource.reload)
  const [reason, setReason] = useState('')
  const owner = user?.role === 'OWNER',
    data = resource.data
  const paused =
    data?.project.status === 'ON_HOLD' || data?.project.status === 'CANCELLED'
  async function transition(value: string) {
    if (!data || !window.confirm(`Change project status: ${label(value)}?`))
      return
    if (
      await action.run(`${base}/status`, {
        action: value,
        expectedRevision: data.project.revision,
        reason,
      })
    )
      setReason('')
  }
  return (
    <>
      <Link to={`/organizations/${orgId}/proposals`}>
        ← Proposals and projects
      </Link>
      <h1>Project overview</h1>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading project…</p>
      ) : (
        data && (
          <>
            <p className={styles.notice}>
              Status: <strong>{label(data.project.status)}</strong>
              {data.project.resumeStatus &&
                ` · Resume to ${label(data.project.resumeStatus)}`}
            </p>
            <p>
              {data.progress.total
                ? `${data.progress.accepted} / ${data.progress.total} required milestones accepted`
                : 'No required milestones yet'}
            </p>
            <p>
              Next action:{' '}
              {paused
                ? 'Workflow changes are paused. Read history below.'
                : data.milestones.some((m) => m.status === 'IN_REVIEW')
                  ? 'Client reviews submitted milestones.'
                  : owner
                    ? 'Manage milestones and prepare the next review.'
                    : 'Check milestone progress below.'}
            </p>
            {owner && (
              <section
                className={styles.panel}
                aria-label="Project status controls"
              >
                <h2>Project status</h2>
                <p>
                  Completion will require a future handover gate and is
                  unavailable.
                </p>
                <Failure error={action.error} reload={resource.reload} />
                <label htmlFor="project-reason">
                  Reason (required for hold or cancellation)
                </label>
                <textarea
                  id="project-reason"
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={action.busy}
                />
                <div className={styles.actions}>
                  {data.project.status === 'PLANNED' && (
                    <button
                      disabled={action.busy}
                      onClick={() => void transition('ACTIVATE')}
                    >
                      Activate project
                    </button>
                  )}
                  {data.project.status === 'ACTIVE' && (
                    <button
                      disabled={action.busy}
                      onClick={() => void transition('REVIEW')}
                    >
                      Move project to in review
                    </button>
                  )}
                  {!paused && (
                    <button
                      disabled={action.busy || !reason.trim()}
                      onClick={() => void transition('HOLD')}
                    >
                      Put on hold
                    </button>
                  )}
                  {data.project.status === 'ON_HOLD' && (
                    <button
                      disabled={action.busy}
                      onClick={() => void transition('RESUME')}
                    >
                      Resume project
                    </button>
                  )}
                  {data.project.status !== 'CANCELLED' && (
                    <button
                      disabled={action.busy || !reason.trim()}
                      onClick={() => void transition('CANCEL')}
                    >
                      Cancel project
                    </button>
                  )}
                </div>
              </section>
            )}
            <section className={styles.panel}>
              <h2>Milestones</h2>
              {!data.milestones.length && <p>No milestones yet.</p>}
              <ol className={styles.recordList}>
                {data.milestones.map((m) => (
                  <li key={m.id}>
                    <Link to={`${base}/milestones/${m.id}`}>
                      {m.position}. {m.title}
                    </Link>
                    <p>
                      {label(m.status)} · {m.required ? 'Required' : 'Optional'}{' '}
                      ·{' '}
                      {m.dueDate
                        ? `Due ${m.dueDate} (Asia/Manila)`
                        : 'No due date'}
                      {m.overdue && ' · Overdue'}
                    </p>
                    <p>{paused ? 'Workflow paused' : nextAction(m, owner)}</p>
                  </li>
                ))}
              </ol>
            </section>
            {owner && !paused && (
              <MilestoneForm
                key={`new-${data.milestones.length}`}
                base={base}
                reload={resource.reload}
                position={Math.min(
                  100,
                  Math.max(0, ...data.milestones.map((m) => m.position)) + 1,
                )}
              />
            )}
            <section className={styles.panel}>
              <h2>Activity history</h2>
              {!data.events.length && <p>No workflow activity yet.</p>}
              <ol className={styles.recordList}>
                {data.events.map((e) => (
                  <li key={e.id}>
                    <strong>{label(e.kind)}</strong> · {e.actor.name} ·{' '}
                    {time(e.createdAt)} (Asia/Manila)
                    <p>
                      {e.fromState ? `${label(e.fromState)} → ` : ''}
                      {label(e.toState)}
                    </p>
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
      <ProjectDeliverables />
      <ProjectChanges />
      <h2>Original approved scope</h2>
      <Failure error={scope.error} reload={scope.reload} />
      {scope.loading ? (
        <p role="status">Loading approved scope…</p>
      ) : (
        scope.data && (
          <>
            <Link
              to={`/organizations/${orgId}/proposals/${scope.data.project.proposalId}?version=${scope.data.project.approvedVersion.id}`}
            >
              View approved proposal version
            </Link>
            <section className={styles.panel}>
              <Snapshot version={scope.data.project.approvedVersion} />
            </section>
          </>
        )
      )}
    </>
  )
}
function MilestoneForm({
  base,
  reload,
  position,
  milestone,
  sharedAction,
}: {
  base: string
  reload: () => void
  position?: number
  milestone?: MilestoneDto
  sharedAction?: ReturnType<typeof useAction>
}) {
  const [value, setValue] = useState<MilestoneInput>(() => ({
    title: milestone?.title ?? '',
    description: milestone?.description ?? '',
    dueDate: milestone?.dueDate ?? null,
    required: milestone?.required ?? true,
    position: milestone?.position ?? position ?? 1,
  }))
  const localAction = useAction(reload)
  const action = sharedAction ?? localAction
  const [validation, setValidation] = useState('')
  const prefix = milestone ? `edit-${milestone.id}` : 'new-milestone'
  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = milestoneInputSchema.safeParse(value)
    if (!input.success) {
      setValidation(
        'Complete the title and text description. Use a valid date and an unused order from 1 to 100.',
      )
      return
    }
    setValidation('')
    await action.run(
      `${base}/milestones${milestone ? `/${milestone.id}` : ''}`,
      {
        ...input.data,
        ...(milestone ? { expectedRevision: milestone.revision } : {}),
      },
      milestone ? 'PATCH' : 'POST',
    )
  }
  return (
    <form className={styles.panel} onSubmit={(e) => void submit(e)}>
      <h2>{milestone ? 'Edit milestone' : 'New milestone'}</h2>
      <p>
        Deliverables are text descriptions only. Use an unused display order;
        existing milestones keep their order.
      </p>
      <Failure error={validation || action.error} reload={reload} />
      <fieldset disabled={action.busy} className={styles.editorFields}>
        <label htmlFor={`${prefix}-title`}>Milestone title</label>
        <input
          id={`${prefix}-title`}
          required
          maxLength={120}
          value={value.title}
          onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
        />
        <label htmlFor={`${prefix}-description`}>Text description</label>
        <textarea
          id={`${prefix}-description`}
          required
          maxLength={12000}
          value={value.description}
          onChange={(e) =>
            setValue((v) => ({ ...v, description: e.target.value }))
          }
        />
        <label htmlFor={`${prefix}-date`}>Due date (Asia/Manila)</label>
        <input
          id={`${prefix}-date`}
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={value.dueDate ?? ''}
          onChange={(e) =>
            setValue((v) => ({ ...v, dueDate: e.target.value || null }))
          }
        />
        <label htmlFor={`${prefix}-position`}>Display order</label>
        <input
          id={`${prefix}-position`}
          type="number"
          required
          min={1}
          max={100}
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
          Required milestone
        </label>
        <button type="submit" className={styles.submit} disabled={action.busy}>
          {action.busy
            ? 'Saving…'
            : milestone
              ? 'Save milestone'
              : 'Create milestone'}
        </button>
      </fieldset>
    </form>
  )
}
export function MilestoneReview() {
  const { orgId, projectId, milestoneId } = useParams(),
    { user } = useSession()
  const base = `/organizations/${orgId}/projects/${projectId}`
  const resource = useResource<WorkflowDto>(`${base}/workflow`)
  return (
    <>
      <Link to={base}>← Project overview</Link>
      <h1>Milestone review</h1>
      <Failure error={resource.error} reload={resource.reload} />
      {resource.loading ? (
        <p role="status">Loading milestone…</p>
      ) : (
        resource.data &&
        (() => {
          const m = resource.data.milestones.find((m) => m.id === milestoneId)
          return m ? (
            <MilestoneContent
              key={`${m.id}-${m.revision}-${resource.data.project.revision}`}
              milestone={m}
              data={resource.data}
              base={base}
              owner={user?.role === 'OWNER'}
              reload={resource.reload}
            />
          ) : (
            <p role="alert">Milestone unavailable.</p>
          )
        })()
      )}
    </>
  )
}
function MilestoneContent({
  milestone: m,
  data,
  base,
  owner,
  reload,
}: {
  milestone: MilestoneDto
  data: WorkflowDto
  base: string
  owner: boolean
  reload: () => void
}) {
  const action = useAction(reload),
    [reason, setReason] = useState(''),
    [feedback, setFeedback] = useState('')
  const paused =
    data.project.status === 'ON_HOLD' || data.project.status === 'CANCELLED'
  const current = m.reviews.find((r) => r.id === m.currentReviewId)
  async function act(value: string) {
    if (window.confirm(`${label(value)} this milestone?`))
      await action.run(`${base}/milestones/${m.id}/actions`, {
        action: value,
        expectedRevision: m.revision,
        reason,
      })
  }
  async function decide(outcome: string) {
    if (
      current &&
      window.confirm(`Record ${label(outcome)} for round ${current.number}?`)
    )
      await action.run(
        `${base}/milestones/${m.id}/reviews/${current.id}/decision`,
        { outcome, feedback },
      )
  }
  return (
    <>
      <h2>{m.title}</h2>
      <p className={styles.notice}>
        {label(m.status)} · {m.required ? 'Required' : 'Optional'} ·{' '}
        {m.dueDate ? `Due ${m.dueDate} (Asia/Manila)` : 'No due date'}
        {m.overdue && ' · Overdue'}
      </p>
      <p className={styles.prose}>{m.description}</p>
      <p>
        Next action:{' '}
        {paused
          ? 'Project is on hold or cancelled. Workflow changes are unavailable.'
          : nextAction(m, owner)}
      </p>
      <Failure error={action.error} reload={reload} />
      {owner && !paused && (
        <section className={styles.panel} aria-label="Milestone actions">
          {(m.status === 'IN_REVIEW' || m.status === 'ACCEPTED') && (
            <>
              <label htmlFor="milestone-reason">
                Reason (required to withdraw or reopen)
              </label>
              <textarea
                id="milestone-reason"
                maxLength={2000}
                disabled={action.busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
          <div className={styles.actions}>
            {m.status === 'PLANNED' && (
              <button disabled={action.busy} onClick={() => void act('START')}>
                Start milestone
              </button>
            )}
            {m.status === 'IN_PROGRESS' && (
              <button disabled={action.busy} onClick={() => void act('SUBMIT')}>
                Submit for review
              </button>
            )}
            {m.status === 'IN_REVIEW' && (
              <button
                disabled={action.busy || !reason.trim()}
                onClick={() => void act('WITHDRAW')}
              >
                Withdraw review round
              </button>
            )}
            {m.status === 'ACCEPTED' && (
              <button
                disabled={action.busy || !reason.trim()}
                onClick={() => void act('REOPEN')}
              >
                Reopen milestone
              </button>
            )}
          </div>
        </section>
      )}
      {owner && !paused && ['PLANNED', 'IN_PROGRESS'].includes(m.status) && (
        <MilestoneForm
          base={base}
          milestone={m}
          reload={reload}
          sharedAction={action}
        />
      )}
      <section className={styles.panel}>
        <h2>Review history</h2>
        {!m.reviews.length && (
          <p>
            No review rounds yet. The owner submits a text description when
            ready.
          </p>
        )}
        {m.reviews.map((r) => (
          <article key={r.id} className={styles.reviewRound}>
            <h3>
              Round {r.number} · {label(r.status)}
              {r.id === m.currentReviewId && ' · Current'}
            </h3>
            <h4>{r.title}</h4>
            <p className={styles.prose}>{r.description}</p>
            <p>
              Submitted by {r.submitter.name} · {time(r.submittedAt)}{' '}
              (Asia/Manila)
            </p>
            {r.decisionActor && (
              <p>
                Decision by {r.decisionActor.name} · {time(r.decidedAt!)}{' '}
                (Asia/Manila)
              </p>
            )}
            {r.feedback && (
              <p className={styles.prose}>Feedback: {r.feedback}</p>
            )}
            {r.withdrawer && (
              <p className={styles.prose}>
                Withdrawn by {r.withdrawer.name} · {time(r.withdrawnAt!)}{' '}
                (Asia/Manila) · {r.withdrawalReason}
              </p>
            )}
            {!owner &&
              !paused &&
              m.status === 'IN_REVIEW' &&
              r.id === m.currentReviewId &&
              r.status === 'PENDING' && (
                <>
                  <label htmlFor="review-feedback">
                    Feedback (required to request changes)
                  </label>
                  <textarea
                    id="review-feedback"
                    value={feedback}
                    maxLength={4000}
                    disabled={action.busy}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <div className={styles.actions}>
                    <button
                      disabled={action.busy}
                      onClick={() => void decide('ACCEPTED')}
                    >
                      {action.busy ? 'Recording…' : 'Accept review round'}
                    </button>
                    <button
                      disabled={action.busy || !feedback.trim()}
                      onClick={() => void decide('CHANGES_REQUESTED')}
                    >
                      Request changes
                    </button>
                  </div>
                </>
              )}
          </article>
        ))}
      </section>
    </>
  )
}
