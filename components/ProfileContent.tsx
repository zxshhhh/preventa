'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useSensors } from '@/context/useSensors'
import { useDevices } from '@/context/useDevice'
import { useHydrated } from '@/lib/useHydrated'
import { isApiConfigured } from '@/lib/api/config'
import {
  activeRecipient,
  createContact,
  createResidence,
  deleteContact,
  deleteResidence,
  fetchProfile,
  fetchResidences,
  isValidRecipient,
  sortContacts,
  saveProfile,
  updateContact,
  updateResidence,
  type ProfileContact,
  type ResidenceEntry,
} from '@/lib/api/profile'

const DEFAULT_AVATAR = '/Profile-sample.png'

const INITIAL_FORM = {
  firstName: 'June Joshua',
  lastName: 'Rabadon',
  email: 'june.rabadon@preventa.io',
  contact: '(+63) 915 5123 867',
  address: 'Zone A, Warehouse District, General Santos City',
}

interface ContactDraft {
  name: string
  phone: string
  priority: number
}

const EMPTY_DRAFT: ContactDraft = { name: '', phone: '', priority: 1 }

export default function ProfileContent() {
  const { pushToast } = useSensors()
  const hydrated = useHydrated()
  const [form, setForm] = useState(INITIAL_FORM)
  const [avatarSrc, setAvatarSrc] = useState(DEFAULT_AVATAR)
  const [contacts, setContacts] = useState<ProfileContact[]>([
    { id: 1, name: 'User TM', phone: '(+63) 915 5123 867', priority: 1 },
  ])
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<ContactDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<ProfileContact['id'] | null>(null)
  const [editDraft, setEditDraft] = useState<ContactDraft>(EMPTY_DRAFT)
  const [confirmDeleteId, setConfirmDeleteId] = useState<ProfileContact['id'] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!hydrated || !isApiConfigured()) return
    let cancelled = false
    void fetchProfile()
      .then((profile) => {
        if (cancelled || !profile) return
        setForm({
          firstName: profile.firstName || INITIAL_FORM.firstName,
          lastName: profile.lastName || INITIAL_FORM.lastName,
          email: profile.email || INITIAL_FORM.email,
          contact: profile.contact || INITIAL_FORM.contact,
          address: profile.address || INITIAL_FORM.address,
        })
        if (profile.contacts?.length) {
          setContacts(profile.contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, priority: c.priority })))
        }
      })
      .catch(() => {
        /* keep the local default profile if the fetch fails */
      })
    return () => {
      cancelled = true
    }
  }, [hydrated])

  const displayName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim().toUpperCase()

  const set = (key: keyof typeof INITIAL_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const applyChanges = () => {
    if (!isApiConfigured()) {
      pushToast('Changes saved', 'Your profile has been updated.')
      return
    }
    void saveProfile({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      contact: form.contact,
      address: form.address,
    })
      .then(() => pushToast('Changes saved', 'Your profile has been synced to the server.'))
      .catch(() => pushToast('Save failed', 'Could not reach the API — changes kept locally.'))
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAvatarSrc(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const addContact = () => {
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
      .catch(() => pushToast('Save failed', 'Could not reach the API — contact not added.'))
  }

  const startEdit = (contact: ProfileContact) => {
    setConfirmDeleteId(null)
    setEditingId(contact.id)
    setEditDraft({ name: contact.name, phone: contact.phone, priority: contact.priority })
  }

  const saveEdit = (original: ProfileContact) => {
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
      .catch(() => pushToast('Save failed', 'Could not reach the API — edits kept for retry.'))
  }

  const removeContact = (contact: ProfileContact) => {
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
      .catch(() => pushToast('Delete failed', 'Could not reach the API — contact kept.'))
  }

  const recipient = activeRecipient(contacts)
  const hasNoValidContact = !contacts.some(isValidRecipient)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-2xl">Profile</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={applyChanges}
            className="btn-primary btn-md"
          >
            APPLY CHANGES
          </button>
        </div>
      </div>
      <div className="flex flex-col items-center">
        <div className="relative group">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <Image
            src={avatarSrc}
            loading="eager"
            alt="profile"
            width={500}
            height={500}
            className="w-35 h-35 md:w-40 md:h-40 rounded-full bg-ember object-cover"
          />
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Change photo"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        </div>
        {avatarSrc !== DEFAULT_AVATAR && (
          <button
            onClick={() => setAvatarSrc(DEFAULT_AVATAR)}
            className="btn-ghost btn-sm mt-2"
          >
            REVERT PHOTO
          </button>
        )}
        <h2 className="text-center text-xl font-bold mt-3">{displayName || 'N/A'}</h2>
      </div>
      <div className="panel-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base text-gray-100">Personal Information</h2>
          <span className="text-xs font-bold text-gray-400">{form.email}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="FIRST NAME" value={form.firstName} onChange={set('firstName')} />
          <Field label="LAST NAME" value={form.lastName} onChange={set('lastName')} />
          <Field label="EMAIL" type="email" value={form.email} onChange={set('email')} />
          <Field label="CONTACT #" value={form.contact} onChange={set('contact')} />
          <div className="sm:col-span-2">
            <Field label="ADDRESS" value={form.address} onChange={set('address')} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="panel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base text-gray-100">Emergency Contact</h2>
            <button
              onClick={() => { setAdding(true); setEditingId(null); setConfirmDeleteId(null) }}
              className="btn-ghost btn-sm"
            >
              + Add Contact
            </button>
          </div>
          {recipient && (
            <p className="text-xs text-gray-400 mb-3">
              Automatic SMS goes to{' '}
              <span className="font-bold text-emerald-400">{recipient.name}</span>
              <span className="text-gray-500"> ({recipient.phone})</span>
            </p>
          )}
          {hasNoValidContact && (
            <p className="text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/25 rounded-lg px-3 py-2 mb-3">
              No valid contact left — automatic SMS stays disabled until a contact is added and synced.
            </p>
          )}
          <div className="space-y-3">
            {sortContacts(contacts).map((contact) => {
              if (editingId === contact.id) {
                return (
                  <div key={contact.id} className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 border border-(--secondary-color)/30">
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Contact name"
                      className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
                    />
                    <input
                      value={editDraft.phone}
                      onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                      placeholder="Contact number"
                      className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
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
                        className="btn-primary btn-sm"
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
                  onEdit={() => startEdit(contact)}
                  onDelete={() => { setEditingId(null); setConfirmDeleteId(contact.id) }}
                  onConfirmDelete={() => removeContact(contact)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              )
            })}
            {adding && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/5">
                <input
                  value={addDraft.name}
                  onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Contact name"
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
                />
                <input
                  value={addDraft.phone}
                  onChange={(e) => setAddDraft((d) => ({ ...d, phone: e.target.value }))}
                  placeholder="Contact number"
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
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
                    className="btn-primary btn-sm"
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

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}

function Field({ label, value, onChange, type = 'text' }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-gray-400 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
      />
    </div>
  )
}

function PriorityPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-bold text-gray-400 tracking-wide">PRIORITY</span>
      {[1, 2, 3, 4, 5].map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={value === p}
          onClick={() => onChange(p)}
          className={
            'h-7 w-7 rounded-lg text-xs font-extrabold transition-colors ' +
            (value === p
              ? 'bg-(--secondary-color) text-white'
              : 'bg-white/5 border border-white/10 text-gray-400 hover:text-gray-200 hover:border-(--secondary-color)/40')
          }
        >
          {p}
        </button>
      ))}
      <span className="text-[10px] text-gray-500 ml-1">1 = first</span>
    </div>
  )
}

interface ContactRowProps {
  contact: ProfileContact
  isRecipient: boolean
  confirming: boolean
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

function ContactRow({ contact, isRecipient, confirming, onDelete, onEdit, onConfirmDelete, onCancelDelete }: ContactRowProps) {
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
          {invalid ? 'Missing number — not SMS-eligible' : contact.phone}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-(--secondary-color)/10 text-(--secondary-color) whitespace-nowrap">
          PRIO {contact.priority}
        </span>
        {isRecipient && (
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 whitespace-nowrap">
            SMS
          </span>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold text-gray-400 hidden sm:inline">Delete?</span>
          <button onClick={onConfirmDelete} className="btn-ghost btn-sm text-(--red-indicator)">YES</button>
          <button onClick={onCancelDelete} className="btn-ghost btn-sm">NO</button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            aria-label={`Edit ${contact.name}`}
            className="btn-icon btn-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${contact.name}`}
            className="btn-icon btn-sm text-(--red-indicator)"
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
      <span className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-emerald-400/10 text-emerald-300 whitespace-nowrap">
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

function ResidencesSection() {
  const { pushToast } = useSensors()
  const { devices, refresh } = useDevices()
  const [residences, setResidences] = useState<ResidenceEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<ResidenceDraft>(EMPTY_RESIDENCE_DRAFT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<ResidenceDraft>(EMPTY_RESIDENCE_DRAFT)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false
    void fetchResidences()
      .then((list) => {
        if (cancelled) return
        setResidences(list)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const deviceCount = (residenceId: number) => devices.filter((d) => d.residenceId === residenceId).length

  const addResidence = () => {
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
      .catch(() => pushToast('Save failed', 'Could not reach the API — residence not added.'))
  }

  const saveEdit = (entry: ResidenceEntry) => {
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
      .catch(() => pushToast('Save failed', 'Could not reach the API — edits kept for retry.'))
  }

  const removeResidence = (entry: ResidenceEntry) => {
    if (!isApiConfigured()) {
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
      .catch(() => pushToast('Delete failed', 'Could not reach the API — residence kept.'))
  }

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-base text-gray-100">Residences</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Group boards by site. Removing a residence deletes its contacts and unlinks its devices.
          </p>
        </div>
        <button
          onClick={() => { setAdding((a) => !a); setEditingId(null); setConfirmDeleteId(null) }}
          className="btn-ghost btn-sm"
        >
          {adding ? 'CANCEL' : '+ Add Residence'}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 mb-3">
          <input
            value={addDraft.address}
            onChange={(e) => setAddDraft((d) => ({ ...d, address: e.target.value }))}
            placeholder="Address (street, city)"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={addDraft.latitude}
              onChange={(e) => setAddDraft((d) => ({ ...d, latitude: e.target.value }))}
              placeholder="Latitude (optional)"
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
            />
            <input
              value={addDraft.longitude}
              onChange={(e) => setAddDraft((d) => ({ ...d, longitude: e.target.value }))}
              placeholder="Longitude (optional)"
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setAddDraft(EMPTY_RESIDENCE_DRAFT) }} className="btn-ghost btn-sm">
              CANCEL
            </button>
            <button onClick={addResidence} disabled={!addDraft.address.trim()} className="btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed">
              SAVE
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <p className="text-xs text-gray-500">Loading residences…</p>
      ) : residences.length === 0 ? (
        <p className="text-xs text-gray-500">No residences yet — add one to start grouping boards.</p>
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
                    placeholder="Address"
                    className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editDraft.latitude}
                      onChange={(e) => setEditDraft((d) => ({ ...d, latitude: e.target.value }))}
                      placeholder="Latitude"
                      className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                    />
                    <input
                      value={editDraft.longitude}
                      onChange={(e) => setEditDraft((d) => ({ ...d, longitude: e.target.value }))}
                      placeholder="Longitude"
                      className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setEditingId(null); setEditDraft(EMPTY_RESIDENCE_DRAFT) }} className="btn-ghost btn-sm">
                      CANCEL
                    </button>
                    <button onClick={() => saveEdit(entry)} className="btn-primary btn-sm">
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
                  <p className="text-[11px] text-gray-500 truncate">
                    {entry.latitude && entry.longitude ? `${entry.latitude}, ${entry.longitude}` : 'No coordinates'}
                    {' · '}
                    {linked === 1 ? '1 device' : `${linked} devices`}
                  </p>
                </div>
                {confirmDeleteId === entry.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-bold text-gray-400 hidden sm:inline">Deletes contacts &amp; unlinks devices —</span>
                    <button onClick={() => removeResidence(entry)} className="btn-ghost btn-sm text-(--red-indicator)">DELETE</button>
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
                      aria-label={`Edit residence ${entry.id}`}
                      className="btn-icon btn-sm"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setConfirmDeleteId(entry.id) }}
                      aria-label={`Remove residence ${entry.id}`}
                      className="btn-icon btn-sm text-(--red-indicator)"
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
