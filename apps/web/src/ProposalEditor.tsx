import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  proposalDraftSchema,
  formatPhp,
  type ProposalDto,
  type ProposalVersionDto,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useResource } from './useResource.js'
import styles from './App.module.css'
type Row = { key: string; description: string; quantity: string; price: string }
function priceToMinor(value: string) {
  if (!/^(0|[1-9][0-9]{0,10})(\.[0-9]{1,2})?$/.test(value))
    throw new Error(
      'Enter prices in PHP with up to two decimal places, without commas.',
    )
  const [whole, fraction = ''] = value.split('.')
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString()
}
const blankRow = (): Row => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: '1',
  price: '0.00',
})
export function ProposalEditor() {
  const { orgId, proposalId, versionId } = useParams()
  const base = `/organizations/${orgId}/proposals`
  const resource = useResource<{ proposal: ProposalDto }>(
    proposalId ? `${base}/${proposalId}` : `/organizations/${orgId}`,
  )
  if (resource.loading) return <p role="status">Loading editor…</p>
  if (resource.error)
    return (
      <p role="alert" className={styles.error}>
        {resource.error}{' '}
        <button onClick={resource.reload}>Reload editor</button>
      </p>
    )
  const proposal = proposalId ? resource.data?.proposal : undefined
  const version = proposal?.versions.find((v) => v.id === versionId)
  if (
    proposalId &&
    (!version || version.state !== 'DRAFT' || proposal?.approved)
  )
    return (
      <section>
        <h1>Draft unavailable</h1>
        <p>Only an unapproved proposal's editable draft can be changed.</p>
        <Link to={`${base}/${proposalId}`}>Return to proposal</Link>
      </section>
    )
  return (
    <DraftForm
      key={version?.id ?? 'new'}
      base={base}
      proposalId={proposalId}
      version={version}
      reload={resource.reload}
    />
  )
}
function DraftForm({
  base,
  proposalId,
  version,
  reload,
}: {
  base: string
  proposalId?: string
  version?: ProposalVersionDto
  reload: () => void
}) {
  const navigate = useNavigate(),
    pending = useRef(false)
  const [title, setTitle] = useState(version?.title ?? ''),
    [scope, setScope] = useState(version?.scope ?? ''),
    [exclusions, setExclusions] = useState(version?.exclusions ?? ''),
    [assumptions, setAssumptions] = useState(
      version?.deliveryAssumptions ?? '',
    ),
    [notes, setNotes] = useState(version?.internalNotes ?? '')
  const [rows, setRows] = useState<Row[]>(
    () =>
      version?.items.map((item) => ({
        key: crypto.randomUUID(),
        description: item.description,
        quantity: String(item.quantity),
        price: `${BigInt(item.unitPriceMinor) / 100n}.${String(BigInt(item.unitPriceMinor) % 100n).padStart(2, '0')}`,
      })) ?? [blankRow()],
  )
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    const leaving = (event: MouseEvent) => {
      if (
        dirty &&
        event.target instanceof Element &&
        event.target.closest('a[href]') &&
        !window.confirm('Discard unsaved draft changes?')
      )
        event.preventDefault()
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', leaving, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', leaving, true)
    }
  }, [dirty])
  function updateRow(index: number, patch: Partial<Row>) {
    setDirty(true)
    setRows((values) =>
      values.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )
  }
  function move(index: number, direction: number) {
    setDirty(true)
    setRows((values) => {
      const next = [...values]
      ;[next[index], next[index + direction]] = [
        next[index + direction]!,
        next[index]!,
      ]
      return next
    })
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    setError('')
    try {
      const input = proposalDraftSchema.safeParse({
        title,
        scope,
        exclusions,
        deliveryAssumptions: assumptions,
        internalNotes: notes,
        currency: 'PHP',
        items: rows.map((row) => ({
          description: row.description,
          quantity: Number(row.quantity),
          unitPriceMinor: priceToMinor(row.price),
        })),
      })
      if (!input.success) {
        setError(
          'Complete the title, scope, and item descriptions. Use 1–100 items, integer quantities of 1–10,000, and prices from PHP 0.00 to PHP 10,000,000,000.00.',
        )
        return
      }
      pending.current = true
      setBusy(true)
      const result = await api<{ proposalId?: string; versionId: string }>(
        version ? `${base}/${proposalId}/versions/${version.id}` : base,
        version ? 'PATCH' : 'POST',
        {
          ...input.data,
          ...(version ? { expectedRevision: version.editRevision } : {}),
        },
      )
      setDirty(false)
      navigate(
        `${base}/${proposalId ?? result.proposalId}?version=${result.versionId}`,
      )
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <Link to={proposalId ? `${base}/${proposalId}` : base}>
        ← Proposal review
      </Link>
      <h1>{version ? `Edit draft v${version.number}` : 'New proposal'}</h1>
      <p>
        Drafts are owner-only. Saving does not publish or supersede a sent
        version.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error} Your input has been kept.
        </p>
      )}
      <form className={styles.panel} onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className={styles.editorFields}>
          <label htmlFor="proposal-title">Proposal title</label>
          <input
            id="proposal-title"
            required
            maxLength={120}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
          />
          <label htmlFor="proposal-scope">Scope</label>
          <textarea
            id="proposal-scope"
            required
            maxLength={12000}
            value={scope}
            onChange={(e) => {
              setScope(e.target.value)
              setDirty(true)
            }}
          />
          <label htmlFor="proposal-exclusions">Exclusions</label>
          <textarea
            id="proposal-exclusions"
            maxLength={12000}
            value={exclusions}
            onChange={(e) => {
              setExclusions(e.target.value)
              setDirty(true)
            }}
          />
          <label htmlFor="proposal-assumptions">Delivery assumptions</label>
          <textarea
            id="proposal-assumptions"
            maxLength={12000}
            value={assumptions}
            onChange={(e) => {
              setAssumptions(e.target.value)
              setDirty(true)
            }}
          />
          <label htmlFor="proposal-notes">Owner-only notes</label>
          <textarea
            id="proposal-notes"
            maxLength={4000}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setDirty(true)
            }}
          />
          <h2>Line items · PHP</h2>
          <p className={styles.description}>
            Enter PHP prices with up to two decimal places. Explicit zero-price
            items are allowed. Quantities: 1–10,000. Maximum 100 items. Total is
            calculated by the server when saved.
          </p>
          {rows.map((row, index) => (
            <fieldset className={styles.itemEditor} key={row.key}>
              <legend>Item {index + 1}</legend>
              <label htmlFor={`description-${row.key}`}>
                Item {index + 1} description
              </label>
              <input
                id={`description-${row.key}`}
                required
                maxLength={500}
                value={row.description}
                onChange={(e) =>
                  updateRow(index, { description: e.target.value })
                }
              />
              <div className={styles.panels}>
                <div>
                  <label htmlFor={`quantity-${row.key}`}>
                    Item {index + 1} quantity
                  </label>
                  <input
                    id={`quantity-${row.key}`}
                    type="number"
                    required
                    min={1}
                    max={10000}
                    step={1}
                    value={row.quantity}
                    onChange={(e) =>
                      updateRow(index, { quantity: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor={`price-${row.key}`}>
                    Item {index + 1} unit price (PHP)
                  </label>
                  <input
                    id={`price-${row.key}`}
                    inputMode="decimal"
                    required
                    value={row.price}
                    maxLength={14}
                    onChange={(e) =>
                      updateRow(index, { price: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  Move item {index + 1} up
                </button>
                <button
                  type="button"
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Move item {index + 1} down
                </button>
                <button
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => {
                    setRows((values) => values.filter((_, i) => i !== index))
                    setDirty(true)
                  }}
                >
                  Remove item {index + 1}
                </button>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={rows.length >= 100}
            onClick={() => {
              setRows((values) => [...values, blankRow()])
              setDirty(true)
            }}
          >
            Add line item
          </button>
          {version && (
            <p>
              Latest saved total:{' '}
              <strong>{formatPhp(version.totalMinor)}</strong>. Unsaved changes
              are not included.
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.submit} disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            {version && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm(
                      'Discard unsaved changes and reload the saved draft?',
                    )
                  )
                    reload()
                }}
              >
                Reload saved draft
              </button>
            )}
          </div>
        </fieldset>
      </form>
    </>
  )
}
