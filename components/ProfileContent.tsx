'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useSensors } from '@/context/useSensors'

interface Contact {
  id: number
  name: string
  phone: string
  badge: string
}

const DEFAULT_AVATAR = '/Profile-sample.png'

const INITIAL_FORM = {
  firstName: 'June Joshua',
  lastName: 'Rabadon',
  email: 'june.rabadon@preventa.io',
  contact: '(+63) 915 5123 867',
  address: 'Zone A, Warehouse District, General Santos City',
}

export default function ProfileContent() {
  const { pushToast } = useSensors()
  const [form, setForm] = useState(INITIAL_FORM)
  const [avatarSrc, setAvatarSrc] = useState(DEFAULT_AVATAR)
  const [contacts, setContacts] = useState<Contact[]>([
    { id: 1, name: 'User TM', phone: '(+63) 915 5123 867', badge: 'SMS' },
  ])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', phone: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  const displayName = [form.firstName, form.lastName].filter(Boolean).join(' ').trim().toUpperCase()

  const set = (key: keyof typeof INITIAL_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const applyChanges = () => {
    pushToast('Changes saved', 'Your profile has been updated.')
  }

  const resetForm = () => {
    setForm(INITIAL_FORM)
    setAvatarSrc(DEFAULT_AVATAR)
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
    setContacts((c) => [
      ...c,
      { id: Date.now(), name: draft.name.trim() || 'New Contact', phone: draft.phone.trim() || '—', badge: 'SMS' },
    ])
    setDraft({ name: '', phone: '' })
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-2xl">PROFILE</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={resetForm}
            className="btn-outline btn-md"
          >
            RESET
          </button>
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
              onClick={() => setAdding(true)}
              className="btn-ghost btn-sm"
            >
              + Add Contact
            </button>
          </div>
          <div className="space-y-3">
            {contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} />
            ))}
            {adding && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/5">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Contact name"
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
                />
                <input
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  placeholder="Contact number"
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-(--secondary-color)/40 focus:border-(--secondary-color) transition-all"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setAdding(false); setDraft({ name: '', phone: '' }) }}
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
            <ContactRow
              contact={{ id: 2, name: 'Bureau of Fire Protection', phone: '(+63) 926 752 0623', badge: 'VERIFIED' }}
            />
          </div>
        </div>
      </div>
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

function ContactRow({ contact }: { contact: Contact }) {
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
        <p className="text-xs text-gray-500">{contact.phone}</p>
      </div>
      <span className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-(--secondary-color)/10 text-(--secondary-color) whitespace-nowrap">
        {contact.badge}
      </span>
    </div>
  )
}