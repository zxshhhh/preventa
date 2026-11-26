'use client'

import { useEffect, useRef, useState } from 'react'
import { useSensors } from '@/context/useSensors'
import { useDevices } from '@/context/useDevice'
import { useHydrated } from '@/lib/useHydrated'
import { useOnline } from '@/lib/useOnline'
import { isApiConfigured } from '@/lib/api/config'
import { getUsername } from '@/lib/api/auth'
import { CACHE_TAGS, CACHE_TTL, peekCache } from '@/lib/api/cache'
import { useCachedQuery } from '@/lib/api/useCachedQuery'
import {
  activeRecipient,
  createContact,
  createResidence,
  deleteContact,
  deleteResidence,
  fetchProfile,
  fetchResidences,
  isValidRecipient,
  PROFILE_CACHE_KEY,
  RESIDENCES_CACHE_KEY,
  sortContacts,
  updateContact,
  updateResidence,
  type ProfileContact,
  type ProfileData,
  type ResidenceEntry,
} from '@/lib/api/profile'
import UserAvatar from '@/components/ui/UserAvatar'
import { SkeletonBar, SkeletonBlock, SkeletonCircle } from '@/components/ui/Skeleton'

interface ContactDraft {
  name: string
  phone: string
  priority: number
}

const EMPTY_DRAFT: ContactDraft = { name: '', phone: '', priority: 1 }

export default function ProfileContent() {
  const { pushToast } = useSensors()
  const hydrated = useHydrated()
  const online = useOnline()
  const [contacts, setContacts] = useState<ProfileContact[]>([])
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<ContactDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<ProfileContact['id'] | null>(null)
  const [editDraft, setEditDraft] = useState<ContactDraft>(EMPTY_DRAFT)
  const [confirmDeleteId, setConfirmDeleteId] = useState<ProfileContact['id'] | null>(null)

  const { data: profile, error: profileError, refresh: refreshProfile } = useCachedQuery<ProfileData | null>(
    PROFILE_CACHE_KEY,
    () => fetchProfile(),
    {
      ...CACHE_TTL.profile,
      persist: true,
      tags: [CACHE_TAGS.profile],
      enabled: hydrated && isApiConfigured(),
    },
  )

  // The cached profile is the source of truth; local state mirrors it so CRUD
  // can update immediately. Sync only when the server-backed list changes, so a
  // stale background refresh cannot silently undo a local edit.
  const profileSignature = profile
    ? profile.contacts.map((c) => `${c.id}|${c.name}|${c.phone}|${c.priority}`).join(';')
    : 'none'
  const syncedProfileRef = useRef<string | null>(null)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  useEffect(() => {
    if (!hydrated || syncedProfileRef.current === profileSignature) return
    syncedProfileRef.current = profileSignature
    const timer = setTimeout(() => {
      // Peek again at timer time: the cached query may have hydrated a saved
      // profile in the same tick, and React may batch both state updates.
      const cached = peekCache<ProfileData | null>(PROFILE_CACHE_KEY)
      const source = cached ?? profile
      setContacts((source?.contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        priority: c.priority,
      })))
      setContactsLoaded(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [hydrated, profileSignature, profile])

  const username = hydrated ? getUsername() : null
  const displayName = username ? username.toUpperCase() : hydrated ? 'USER' : ''

  const addContact = () => {
    if (!online) return
    const name = addDraft.name.trim() || 'New Contact'
    const phone = addDraft.phone.trim()
    const priority = addDraft.priority
    if (!isApiConfigured()) {
      setContacts((c) => sortContacts([...c, { id: Date.now(), name, phone, priority }]))
      setAddDraft(EMPTY_DRAFT)
      setAdding(false)
      return
    }
    void createContact({ name, phone, priority })
      .then((contact) => {
        setContacts((c) => sortContacts([...c, { id: contact.id, name: contact.name, phone: contact.phone, priority: contact.priority }]))
        setAddDraft(EMPTY_DRAFT)
        setAdding(false)
        pushToast('Contact added', `${contact.name} was added to this residence.`)
      })
      .catch(() => pushToast('Save failed', 'We could not save the contact. Please check your connection and try again.'))
  }

  const startEdit = (contact: ProfileContact) => {
    setConfirmDeleteId(null)
    setEditingId(contact.id)
    setEditDraft({ name: contact.name, phone: contact.phone, priority: contact.priority })
  }

  const saveEdit = (original: ProfileContact) => {
    if (!online) return
    // Send only the changed fields, per the PATCH /contacts/{id}/ contract.
    const changes: { name?: string; phone?: string; priority?: number } = {}
    const name = editDraft.name.trim() || original.name
    const phone = editDraft.phone.trim()
    if (name !== original.name) changes.name = name
    if (phone !== original.phone) changes.phone = phone
    if (editDraft.priority !== original.priority) changes.priority = editDraft.priority

    const finish = (updated: ProfileContact) => {
      setContacts((c) => sortContacts(c.map((c2) => (c2.id === original.id ? { ...updated, id: original.id } : c2))))
      setEditingId(null)
      pushToast('Contact updated', `${updated.name} was saved.`)
    }

    if (!isApiConfigured() || Object.keys(changes).length === 0) {
      finish({ ...original, name: changes.name ?? original.name, phone: changes.phone ?? original.phone, priority: changes.priority ?? original.priority })
      return
    }
    void updateContact(original.id, changes)
      .then((updated) => finish(updated))
      .catch(() => pushToast('Save failed', 'We could not save your changes. Your edits are still here, so you can try again.'))
  }

  const removeContact = (contact: ProfileContact) => {
    if (!online) return
    const finish = () => {
      setContacts((c) => c.filter((c2) => c2.id !== contact.id))
      setConfirmDeleteId(null)
      pushToast('Contact removed', `${contact.name} was deleted.`)
    }
    if (!isApiConfigured()) {
      finish()
      return
    }
    void deleteContact(contact.id)
      .then(finish)
      .catch(() => pushToast('Delete failed', 'We could not remove the contact. It is still in your list.'))
  }

  const recipient = activeRecipient(contacts)
  const hasNoValidContact = contactsLoaded && !profileError && !contacts.some(isValidRecipient)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-bold text-2xl">Profile</h1>
      <div className="flex flex-col items-center">
        <UserAvatar size="lg" />
        <h2 className="text-center text-xl font-bold mt-3">{displayName}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="panel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base text-gray-100">Emergency Contact</h2>
            <button
              onClick={() => { setAdding(true); setEditingId(null); setConfirmDeleteId(null) }}
              disabled={!online}
              title={online ? undefined : 'Reconnect to make changes'}
              className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add Contact
            </button>
          </div>
          {!online && (
            <p className="text-xs font-semibold text-(--amber-indicator) mb-3">
              You are offline. You can view contacts, but you cannot change them until you reconnect.
            </p>
          )}
          {Boolean(profileError) && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-(--red-indicator)/30 bg-(--red-indicator)/10 px-3 py-2 mb-3">
              <span className="text-xs font-semibold text-(--red-indicator)">
                We could not load your contacts. Please try again.
              </span>
              <button onClick={() => void refreshProfile()} className="btn-ghost btn-sm">
                RETRY
              </button>
            </div>
          )}
          {recipient && (
            <p className="text-xs text-gray-400 mb-3">
              Automatic SMS goes to{' '}
              <span className="font-bold text-emerald-400">{recipient.name}</span>
              <span className="text-gray-500"> ({recipient.phone})</span>
            </p>
          )}
          {hasNoValidContact && (
            <p className="text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/25 rounded-lg px-3 py-2 mb-3">
              Automatic SMS is paused because no contact has a phone number yet. Add a contact with a number to turn it back on.
            </p>
          )}
          <div className="space-y-3">
            {hydrated && isApiConfigured() && !contactsLoaded ? (
              <ContactSkeletonRows />
            ) : (
              <>
                {sortContacts(contacts).map((contact) => {
                  if (editingId === contact.id) {
                    return (
                      <div key={contact.id} className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 border border-(--secondary-color)/30">
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          aria-label="Contact name" placeholder="Contact name"
                          className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
                        />
                        <input
                          value={editDraft.phone}
                          onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                          aria-label="Contact phone number" placeholder="Contact number"
                          className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
                        />
                        <PriorityPicker
                          value={editDraft.priority}
                          onChange={(priority) => setEditDraft((d) => ({ ...d, priority }))}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setEditingId(null); setEditDraft(EMPTY_DRAFT) }}
                            className="btn-ghost btn-sm"
                          >
                            CANCEL
                          </button>
                          <button
                            onClick={() => saveEdit(contact)}
                            disabled={!online}
                            className="btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            SAVE
                          </button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      isRecipient={recipient?.id === contact.id}
                      confirming={confirmDeleteId === contact.id}
                      offline={!online}
                      onEdit={() => startEdit(contact)}
                      onDelete={() => { setEditingId(null); setConfirmDeleteId(contact.id) }}
                      onConfirmDelete={() => removeContact(contact)}
                      onCancelDelete={() => setConfirmDeleteId(null)}
                    />
                  )
                })}
                {contactsLoaded && contacts.length === 0 && !profileError && (
                  <p className="text-xs text-gray-500">
                    No contact information yet. Add your first emergency contact with a phone number so we can send SMS alerts when an incident happens.
                  </p>
                )}
              </>
            )}
            {adding && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/5">
                <input
                  value={addDraft.name}
                  onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
                  aria-label="Contact name" placeholder="Contact name"
                  className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
                />
                <input
                  value={addDraft.phone}
                  onChange={(e) => setAddDraft((d) => ({ ...d, phone: e.target.value }))}
                  aria-label="Contact phone number" placeholder="Contact number"
                  className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
                />
                <PriorityPicker
                  value={addDraft.priority}
                  onChange={(priority) => setAddDraft((d) => ({ ...d, priority }))}
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setAdding(false); setAddDraft(EMPTY_DRAFT) }}
                    className="btn-ghost btn-sm"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={addContact}
                    disabled={!online}
                    className="btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    SAVE
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="panel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base text-gray-100">Authority Emergency Services</h2>
          </div>
          <div className="space-y-3">
            <StaticRow
              name="Bureau of Fire Protection"
              phone="(+63) 926 752 0623"
              badge="VERIFIED"
            />
          </div>
        </div>
      </div>
      <ResidencesSection />
    </div>
  )
}

function PriorityPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-bold text-gray-400 tracking-wide">PRIORITY</span>
      {[1, 2, 3, 4, 5].map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          className={
            'h-7 w-7 rounded-lg text-xs font-extrabold transition-colors ' +
            (value === p
              ? 'bg-(--secondary-color) text-(--on-accent)'
              : 'bg-white/5 border border-white/10 text-gray-400 hover:text-gray-200 hover:border-(--secondary-color)/40')
          }
        >
          {p}
        </button>
      ))}
      <span className="text-xs text-gray-500 ml-1">1 = first</span>
    </div>
  )
}

interface ContactRowProps {
  contact: ProfileContact
  isRecipient: boolean
  confirming: boolean
  offline: boolean
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function ContactRow({ contact, isRecipient, confirming, offline, onDelete, onEdit, onConfirmDelete, onCancelDelete }: ContactRowProps) {
  const invalid = !isValidRecipient(contact)
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-(--secondary-color)/10 text-(--secondary-color)">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="2" />
          <path d="M13 15C13 16.1046 13 17 9 17C5 17 5 16.1046 5 15C5 13.8954 6.79086 13 9 13C11.2091 13 13 13.8954 13 15Z" />
          <path d="M14 8H19M16.5 5.5V10.5" strokeLinecap="round" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-100 truncate">{contact.name}</p>
        <p className={'text-xs truncate ' + (invalid ? 'text-amber-400 font-semibold' : 'text-gray-500')}>
          {invalid ? 'Missing phone number. This contact cannot receive SMS alerts.' : contact.phone}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-(--secondary-color)/10 text-(--secondary-color) whitespace-nowrap">
          PRIO {contact.priority}
        </span>
        {isRecipient && (
          <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 whitespace-nowrap">
            SMS
          </span>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs font-bold text-gray-400 hidden sm:inline">Delete?</span>
          <button onClick={onConfirmDelete} disabled={offline} className="btn-ghost btn-sm text-(--red-indicator) disabled:opacity-40 disabled:cursor-not-allowed">YES</button>
          <button onClick={onCancelDelete} className="btn-ghost btn-sm">NO</button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            disabled={offline}
            aria-label={`Edit ${contact.name}`}
            title={offline ? 'Reconnect to make changes' : undefined}
            className="btn-icon btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            disabled={offline}
            aria-label={`Delete ${contact.name}`}
            className="btn-icon btn-sm text-(--red-indicator) disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function ContactSkeletonRows() {
  return (
    <div role="status" aria-label="Loading emergency contacts" className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
          <SkeletonCircle className="h-10 w-10" />
          <div className="flex-1 min-w-0">
            <SkeletonBar className="h-3.5 w-2/5" />
            <SkeletonBar className="mt-2 h-3 w-3/5" />
          </div>
          <SkeletonBar className="h-5 w-16 rounded-full" />
          <div className="flex items-center gap-1 shrink-0">
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

function StaticRow({ name, phone, badge }: { name: string; phone: string; badge: string }) {  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-400/10 text-emerald-300">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-100 truncate">{name}</p>
        <p className="text-xs text-gray-500">{phone}</p>
      </div>
      <span className="text-xs font-extrabold px-2 py-1 rounded-full bg-emerald-400/10 text-emerald-300 whitespace-nowrap">
        {badge}
      </span>
    </div>
  )
}

interface ResidenceDraft {
  address: string
  latitude: string
  longitude: string
}

const EMPTY_RESIDENCE_DRAFT: ResidenceDraft = { address: '', latitude: '', longitude: '' }

function ResidenceSkeletonRows() {
  return (
    <div role="status" aria-label="Loading residences" className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
          <SkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 min-w-0">
            <SkeletonBar className="h-3.5 w-1/2" />
            <SkeletonBar className="mt-2 h-3 w-4/5" />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
            <SkeletonBlock className="h-7 w-7 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ResidencesSection() {
  const { pushToast } = useSensors()
  const { devices, refresh } = useDevices()
  const hydrated = useHydrated()
  const online = useOnline()
  const [residences, setResidences] = useState<ResidenceEntry[]>([])
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<ResidenceDraft>(EMPTY_RESIDENCE_DRAFT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<ResidenceDraft>(EMPTY_RESIDENCE_DRAFT)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // Same persisted entry as the profile API uses, so a reload or a return
  // visit renders the saved list without another /residences/ request.
  const {
    data: cachedResidences,
    error,
    refresh: refreshResidences,
  } = useCachedQuery<ResidenceEntry[]>(
    RESIDENCES_CACHE_KEY,
    () => fetchResidences(),
    {
      ...CACHE_TTL.profile,
      persist: true,
      tags: [CACHE_TAGS.profile],
      enabled: hydrated && isApiConfigured(),
    },
  )

  const residenceSignature = cachedResidences ? JSON.stringify(cachedResidences) : 'none'
  const syncedResidencesRef = useRef<string | null>(null)
  useEffect(() => {
    if (!hydrated || syncedResidencesRef.current === residenceSignature) return
    syncedResidencesRef.current = residenceSignature
    const timer = setTimeout(() => {
      const cached = peekCache<ResidenceEntry[]>(RESIDENCES_CACHE_KEY)
      setResidences(cached ?? cachedResidences ?? [])
    }, 0)
    return () => clearTimeout(timer)
  }, [hydrated, residenceSignature, cachedResidences])

  const loaded = !isApiConfigured() || cachedResidences !== null || Boolean(error)

  const deviceCount = (residenceId: number) => devices.filter((d) => d.residenceId === residenceId).length

  const addResidence = () => {
    if (!online) return
    const address = addDraft.address.trim()
    if (!address) return
    if (!isApiConfigured()) {
      pushToast('Sign in required', 'Connect the API to manage residences.')
      return
    }
    void createResidence({
      address,
      latitude: addDraft.latitude.trim() || null,
      longitude: addDraft.longitude.trim() || null,
    })
      .then((entry) => {
        setResidences((r) => [...r, entry])
        setAddDraft(EMPTY_RESIDENCE_DRAFT)
        setAdding(false)
        refresh()
        pushToast('Residence added', `${address || `Residence ${entry.id}`} was created.`)
      })
      .catch(() => pushToast('Save failed', 'We could not add the residence. Please check your connection and try again.'))
  }

  const saveEdit = (entry: ResidenceEntry) => {
    if (!online) return
    const address = editDraft.address.trim() || entry.address
    const changes: { address?: string; latitude?: string | null; longitude?: string | null } = {}
    if (address !== entry.address) changes.address = address
    if (editDraft.latitude.trim() !== (entry.latitude ?? '')) changes.latitude = editDraft.latitude.trim() || null
    if (editDraft.longitude.trim() !== (entry.longitude ?? '')) changes.longitude = editDraft.longitude.trim() || null

    const finish = (updated: ResidenceEntry) => {
      setResidences((r) => r.map((r2) => (r2.id === entry.id ? updated : r2)))
      setEditingId(null)
      refresh()
      pushToast('Residence updated', 'The address was saved.')
    }

    if (!isApiConfigured() || Object.keys(changes).length === 0) {
      finish({ ...entry, ...changes, latitude: changes.latitude ?? entry.latitude, longitude: changes.longitude ?? entry.longitude })
      return
    }
    void updateResidence(entry.id, changes)
      .then(finish)
      .catch(() => pushToast('Save failed', 'We could not save your changes. Your edits are still here, so you can try again.'))
  }

  const removeResidence = (entry: ResidenceEntry) => {
    if (!online || !isApiConfigured()) {
      setConfirmDeleteId(null)
      return
    }
    void deleteResidence(entry.id)
      .then(() => {
        setResidences((r) => r.filter((r2) => r2.id !== entry.id))
        setConfirmDeleteId(null)
        refresh()
        pushToast('Residence removed', `${entry.address || `Residence ${entry.id}`} was deleted along with its contacts.`)
      })
      .catch(() => pushToast('Delete failed', 'We could not remove the residence. It is still in your list.'))
  }

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-base text-gray-100">Residences</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Group boards by site. Removing a residence deletes its contacts and unlinks its devices.
          </p>
          {!online && (
            <p className="text-xs font-semibold text-(--amber-indicator) mt-1">
              You are offline. You can view residences, but you cannot change them until you reconnect.
            </p>
          )}
          {Boolean(error) && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-(--red-indicator)/30 bg-(--red-indicator)/10 px-3 py-2 mt-2"
            >
              <span className="text-xs font-semibold text-(--red-indicator)">
                We could not load your residences. Please try again.
              </span>
              <button onClick={() => void refreshResidences()} className="btn-ghost btn-sm">
                RETRY
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => { setAdding((a) => !a); setEditingId(null); setConfirmDeleteId(null) }}
          disabled={!online}
          title={online ? undefined : 'Reconnect to make changes'}
          className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? 'CANCEL' : '+ Add Residence'}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 mb-3">
          <input
            value={addDraft.address}
            onChange={(e) => setAddDraft((d) => ({ ...d, address: e.target.value }))}
            aria-label="Residence address (street, city)" placeholder="Address (street, city)"
            className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={addDraft.latitude}
              onChange={(e) => setAddDraft((d) => ({ ...d, latitude: e.target.value }))}
              aria-label="Residence latitude (optional)" placeholder="Latitude (optional)"
              className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
            />
            <input
              value={addDraft.longitude}
              onChange={(e) => setAddDraft((d) => ({ ...d, longitude: e.target.value }))}
              aria-label="Residence longitude (optional)" placeholder="Longitude (optional)"
              className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setAddDraft(EMPTY_RESIDENCE_DRAFT) }} className="btn-ghost btn-sm">
              CANCEL
            </button>
            <button onClick={addResidence} disabled={!online || !addDraft.address.trim()} className="btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed">
              SAVE
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <ResidenceSkeletonRows />
      ) : residences.length === 0 ? (
        error ? null : (
          <p className="text-xs text-gray-500">
            No residence information yet. Add your first residence to organize your boards by site.
          </p>
        )
      ) : (
        <div className="space-y-3">
          {residences.map((entry) => {
            const linked = deviceCount(entry.id)
            if (editingId === entry.id) {
              return (
                <div key={entry.id} className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 border border-(--secondary-color)/30">
                  <input
                    value={editDraft.address}
                    onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))}
                    aria-label="Residence address" placeholder="Address"
                    className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-(--secondary-color) transition-all"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editDraft.latitude}
                      onChange={(e) => setEditDraft((d) => ({ ...d, latitude: e.target.value }))}
                      aria-label="Residence latitude" placeholder="Latitude"
                      className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                    />
                    <input
                      value={editDraft.longitude}
                      onChange={(e) => setEditDraft((d) => ({ ...d, longitude: e.target.value }))}
                      aria-label="Residence longitude" placeholder="Longitude"
                      className="h-9 rounded-lg border border-white/40 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setEditingId(null); setEditDraft(EMPTY_RESIDENCE_DRAFT) }} className="btn-ghost btn-sm">
                      CANCEL
                    </button>
                    <button onClick={() => saveEdit(entry)} disabled={!online} className="btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed">
                      SAVE
                    </button>
                  </div>
                </div>
              )
            }
            return (
              <div key={entry.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
                <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-(--secondary-color)/10 text-(--secondary-color)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 10.5 12 3l9 7.5" />
                    <path d="M5 9.5V21h14V9.5" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-100 truncate">{entry.address || `Residence ${entry.id}`}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {entry.latitude && entry.longitude ? `${entry.latitude}, ${entry.longitude}` : 'No coordinates'}
                    {' · '}
                    {linked === 1 ? '1 device' : `${linked} devices`}
                  </p>
                </div>
                {confirmDeleteId === entry.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs font-bold text-gray-400 hidden sm:inline">This also deletes its contacts and unlinks its devices.</span>
                    <button onClick={() => removeResidence(entry)} disabled={!online} className="btn-ghost btn-sm text-(--red-indicator) disabled:opacity-40 disabled:cursor-not-allowed">DELETE</button>
                    <button onClick={() => setConfirmDeleteId(null)} className="btn-ghost btn-sm">CANCEL</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setConfirmDeleteId(null)
                        setEditingId(entry.id)
                        setEditDraft({ address: entry.address, latitude: entry.latitude ?? '', longitude: entry.longitude ?? '' })
                      }}
                      disabled={!online}
                      aria-label={`Edit residence ${entry.id}`}
                      className="btn-icon btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setConfirmDeleteId(entry.id) }}
                      disabled={!online}
                      aria-label={`Remove residence ${entry.id}`}
                      className="btn-icon btn-sm text-(--red-indicator) disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
