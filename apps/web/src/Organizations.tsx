import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  contactSchema,
  inviteSchema,
  organizationSchema,
  type OrganizationSummary,
  type OrganizationDetail,
} from '@jcb/contracts'
import { api, errorMessage } from './api.js'
import { useSession } from './session.js'
import styles from './App.module.css'
export function Organizations() {
  const { user } = useSession(),
    navigate = useNavigate()
  const [data, setData] = useState<{
      organizations: OrganizationSummary[]
      hasMore: boolean
    } | null>(null),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0)
  const [name, setName] = useState(''),
    [notes, setNotes] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api<{ organizations: OrganizationSummary[]; hasMore: boolean }>(
      `/organizations?page=${page}`,
    )
      .then((value) => {
        if (live) {
          setData(value)
          setError('')
        }
      })
      .catch((error) => {
        if (live) setError(errorMessage(error))
      })
    return () => {
      live = false
    }
  }, [page, attempt])
  async function create(event: FormEvent) {
    event.preventDefault()
    const input = organizationSchema.safeParse({ name, notes })
    if (!input.success) {
      setError(
        'Enter an organization name (up to 120 characters) and notes (up to 4,000).',
      )
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await api<{ organization: OrganizationSummary }>(
        '/organizations',
        'POST',
        input.data,
      )
      navigate(`/organizations/${data.organization.id}`)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <p className={styles.eyebrow}>CLIENT WORKSPACE</p>
      <h1>Organizations</h1>
      <p className={styles.description}>
        {user?.role === 'OWNER'
          ? 'Manage client organizations, contacts, and access.'
          : 'Organizations you have been invited to join.'}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}{' '}
          <button onClick={() => setAttempt((v) => v + 1)}>
            Reload organizations
          </button>
        </p>
      )}
      <div className={styles.panels}>
        <section className={styles.panel} aria-label="Organization list">
          {!data ? (
            <p role="status">Loading organizations…</p>
          ) : data.organizations.length ? (
            <ul className={styles.recordList}>
              {data.organizations.map((org) => (
                <li key={org.id}>
                  <Link to={`/organizations/${org.id}`}>{org.name}</Link>
                  {org.archivedAt && <span>Archived</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No organizations yet.{' '}
              {user?.role === 'OWNER'
                ? 'Create one to invite a client.'
                : 'Accept an invitation from jcb to get access.'}
            </p>
          )}
          <div className={styles.actions}>
            <button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={!data?.hasMore}
              onClick={() => setPage((v) => v + 1)}
            >
              Next
            </button>
          </div>
        </section>
        {user?.role === 'OWNER' && (
          <section className={styles.card}>
            <h2>Add organization</h2>
            <form onSubmit={(event) => void create(event)}>
              <label htmlFor="org-name">Organization name</label>
              <input
                id="org-name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label htmlFor="org-notes">Private discovery notes</label>
              <textarea
                id="org-notes"
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button className={styles.submit} disabled={busy}>
                {busy ? 'Creating…' : 'Create organization'}
              </button>
            </form>
          </section>
        )}
      </div>
    </>
  )
}
export function Organization() {
  const { id } = useParams()
  return <OrganizationPage key={id} />
}
function OrganizationPage() {
  const { id } = useParams(),
    { user } = useSession()
  const [data, setData] = useState<OrganizationDetail | null>(null),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [name, setName] = useState(''),
    [notes, setNotes] = useState(''),
    [contactName, setContactName] = useState(''),
    [contactEmail, setContactEmail] = useState(''),
    [editContact, setEditContact] = useState<string | null>(null),
    [inviteEmail, setInviteEmail] = useState('')
  const [inviteRequest, setInviteRequest] = useState<{
    key: string
    email: string
  } | null>(null)
  const [confirmedInviteEmail, setConfirmedInviteEmail] = useState('')
  const base = `/organizations/${id}`
  useEffect(() => {
    let live = true
    api<OrganizationDetail>(base)
      .then((value) => {
        if (live) {
          setData(value)
          setName(value.organization.name)
          setNotes(value.organization.notes ?? '')
          setError('')
          setLoading(false)
        }
      })
      .catch((error) => {
        if (live) {
          setData(null)
          setError(errorMessage(error))
          setLoading(false)
        }
      })
    return () => {
      live = false
    }
  }, [base, attempt])
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(base + path, method, body)
      setNotice(message)
      setAttempt((v) => v + 1)
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function saveOrganization(event: FormEvent) {
    event.preventDefault()
    const input = organizationSchema.safeParse({ name, notes })
    if (!input.success) {
      setError('Check the organization name and notes.')
      return
    }
    await mutate('', 'PATCH', input.data, 'Organization updated.')
  }
  async function saveContact(event: FormEvent) {
    event.preventDefault()
    const input = contactSchema.safeParse({
      name: contactName,
      email: contactEmail,
    })
    if (!input.success) {
      setError('Enter a contact name and valid email.')
      return
    }
    if (
      await mutate(
        `/contacts${editContact ? `/${editContact}` : ''}`,
        editContact ? 'PATCH' : 'POST',
        input.data,
        'Contact saved. Contacts do not grant access.',
      )
    ) {
      setContactName('')
      setContactEmail('')
      setEditContact(null)
    }
  }
  async function invite(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const pending = inviteRequest ?? {
      key: crypto.randomUUID(),
      email: inviteEmail.trim().toLowerCase(),
    }
    const input = inviteSchema.safeParse({
      email: pending.email,
      requestKey: pending.key,
      reissueConfirmed: confirmedInviteEmail === pending.email,
    })
    if (!input.success) {
      setError('Enter a valid invitation email.')
      return
    }
    setInviteRequest(pending)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ invitation: { delivery: string } }>(
        base + '/invitations',
        'POST',
        input.data,
      )
      const messages: Record<string, string> = {
        accepted:
          'Email accepted by the mail service. Inbox delivery is not confirmed.',
        sending:
          'This request is still sending. Check the same request again shortly.',
        unconfirmed:
          'Delivery is unconfirmed. Checking again will not send another email. Deliberately reissue if needed.',
        failed:
          'Email was rejected. Fix delivery configuration before deliberately reissuing.',
        revoked: 'This invitation is revoked. Deliberately reissue if needed.',
        consumed: 'This invitation has already been accepted.',
      }
      setNotice(
        messages[result.invitation.delivery] ?? 'Check invitation history.',
      )
      setAttempt((v) => v + 1)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Link to="/organizations">← Organizations</Link>
      {error && (
        <p className={styles.error} role="alert">
          {error}{' '}
          <button onClick={() => setAttempt((v) => v + 1)}>
            Reload organization
          </button>
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Loading organization…</p>
      ) : (
        data && (
          <>
            <h1>{data.organization.name}</h1>
            <p>
              <Link
                className={styles.actionLink}
                to={`/organizations/${id}/proposals`}
              >
                Proposals and projects
              </Link>
            </p>
            {data.organization.archivedAt && (
              <p className={styles.notice}>
                Archived organization. Restore it to issue invitations.
              </p>
            )}
            {user?.role !== 'OWNER' ? (
              <section className={styles.panel}>
                <h2>Your organization access is active.</h2>
                <p>
                  You can access this organization through your accepted
                  invitation. Use Proposals and projects to review shared scope
                  and track project milestones.
                </p>
              </section>
            ) : (
              <>
                <div className={styles.panels}>
                  <section className={styles.card}>
                    <h2>Organization details</h2>
                    <form onSubmit={(event) => void saveOrganization(event)}>
                      <label htmlFor="detail-name">Organization name</label>
                      <input
                        id="detail-name"
                        required
                        maxLength={120}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <label htmlFor="detail-notes">
                        Private discovery notes
                      </label>
                      <textarea
                        id="detail-notes"
                        maxLength={4000}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                      <button className={styles.submit} disabled={busy}>
                        Save organization
                      </button>
                    </form>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          '',
                          'PATCH',
                          { archived: !data.organization.archivedAt },
                          data.organization.archivedAt
                            ? 'Organization restored.'
                            : 'Organization archived. Client access is unavailable while archived.',
                        )
                      }
                    >
                      {data.organization.archivedAt
                        ? 'Restore organization'
                        : 'Archive organization'}
                    </button>
                  </section>
                  <section className={styles.card}>
                    <h2>Invite a client</h2>
                    <p className={styles.description}>
                      Invitation-only access. Valid for 72 hours. Reissuing
                      revokes earlier unused links.
                    </p>
                    <form onSubmit={(event) => void invite(event)}>
                      <label htmlFor="invite-email">Invitation email</label>
                      <input
                        id="invite-email"
                        type="email"
                        required
                        maxLength={254}
                        disabled={busy || !!inviteRequest}
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <button
                        className={styles.submit}
                        disabled={busy || !!data.organization.archivedAt}
                      >
                        {busy
                          ? 'Working…'
                          : inviteRequest
                            ? 'Check previous request'
                            : 'Send invitation'}
                      </button>
                    </form>
                    <p className={styles.description}>
                      Check invitation status below. Mail-service acceptance
                      does not confirm inbox delivery.
                    </p>
                  </section>
                </div>
                <section className={styles.panel}>
                  <h2>Contacts</h2>
                  <p className={styles.description}>
                    Business contacts only. Adding a contact does not create an
                    account or grant access.
                  </p>
                  <ul className={styles.recordList}>
                    {data.contacts?.map((contact) => (
                      <li key={contact.id}>
                        <span>
                          {contact.name} · {contact.email}
                          {contact.archivedAt && ' · Archived'}
                        </span>
                        <div className={styles.actions}>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setEditContact(contact.id)
                              setContactName(contact.name)
                              setContactEmail(contact.email)
                            }}
                          >
                            Edit contact
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/contacts/${contact.id}`,
                                'PATCH',
                                { archived: !contact.archivedAt },
                                'Contact archive status updated.',
                              )
                            }
                          >
                            {contact.archivedAt
                              ? 'Restore contact'
                              : 'Archive contact'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!data.contacts?.length && <p>No contacts yet.</p>}
                  <form
                    className={styles.inlineForm}
                    onSubmit={(event) => void saveContact(event)}
                  >
                    <div>
                      <label htmlFor="contact-name">Contact name</label>
                      <input
                        id="contact-name"
                        required
                        maxLength={120}
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email">Contact email</label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        maxLength={254}
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                      />
                    </div>
                    <button disabled={busy}>
                      {editContact ? 'Save contact' : 'Add contact'}
                    </button>
                    {editContact && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditContact(null)
                          setContactName('')
                          setContactEmail('')
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </form>
                </section>
                <section className={styles.panel}>
                  <h2>Memberships</h2>
                  <ul className={styles.recordList}>
                    {data.memberships?.map((member) => (
                      <li key={member.id}>
                        <span>
                          {member.user.name} · {member.user.email} ·{' '}
                          {member.revokedAt ? 'Revoked' : 'Active'}
                        </span>
                        {!member.revokedAt && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Revoke ${member.user.name}'s organization access?`,
                                )
                              )
                                void mutate(
                                  `/memberships/${member.id}`,
                                  'DELETE',
                                  undefined,
                                  'Membership revoked. Existing sessions no longer authorize this organization.',
                                )
                            }}
                          >
                            Revoke access
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!data.memberships?.length && (
                    <p>No client memberships yet.</p>
                  )}
                </section>
                {inviteRequest && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Start a new invitation? Sending it will revoke earlier unaccepted invitations for this organization and email.',
                        )
                      ) {
                        setConfirmedInviteEmail(inviteRequest.email)
                        setInviteRequest(null)
                        setNotice('')
                        setError('')
                      }
                    }}
                  >
                    Start new invitation / deliberate reissue
                  </button>
                )}
                <section className={styles.panel}>
                  <h2>Invitation history</h2>
                  <ul className={styles.recordList}>
                    {data.invitations?.map((invite) => (
                      <li key={invite.id}>
                        <span>{invite.email}</span>
                        <span>
                          {invite.deliveryFailed
                            ? 'Delivery rejected'
                            : invite.acceptedAt
                              ? 'Accepted'
                              : invite.revokedAt
                                ? 'Revoked'
                                : new Date(invite.expiresAt) <= new Date()
                                  ? 'Expired'
                                  : invite.deliveredAt
                                    ? 'Accepted by mail service'
                                    : invite.deliveryState === 'sending' &&
                                        invite.sendDeadline &&
                                        new Date(invite.sendDeadline) >
                                          new Date()
                                      ? 'Sending (check again shortly)'
                                      : 'Delivery unconfirmed'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!data.invitations?.length && <p>No invitations yet.</p>}
                </section>
                <section className={styles.panel}>
                  <h2>Activity history</h2>
                  <ul className={styles.recordList}>
                    {data.activities?.map((event) => (
                      <li key={event.id}>
                        <span>
                          {event.kind.toLowerCase().replaceAll('_', ' ')} ·{' '}
                          {event.actor.name}
                        </span>
                        <time dateTime={event.createdAt}>
                          {new Intl.DateTimeFormat('en-PH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: 'Asia/Manila',
                          }).format(new Date(event.createdAt))}
                        </time>
                      </li>
                    ))}
                  </ul>
                  {!data.activities?.length && <p>No access activity yet.</p>}
                  <p className={styles.description}>
                    Showing up to 100 records per section. Times are in
                    Asia/Manila.
                  </p>
                </section>
              </>
            )}
          </>
        )
      )}
    </>
  )
}
