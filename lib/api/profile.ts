import { apiGet, apiPost, apiPatch, apiDelete } from './client'
import { CACHE_TAGS, CACHE_TTL, cachedFetch, invalidateTags } from './cache'
import { ENDPOINTS } from './endpoints'

/** Shared cache keys — the profile UI subscribes to the same entries. */
export const PROFILE_CACHE_KEY = 'profile'
export const RESIDENCES_CACHE_KEY = 'residences'

export interface ProfileContact {
  id: string | number
  name: string
  phone: string
  priority: number
}

export interface ProfileData {
  firstName: string
  lastName: string
  email: string
  contact: string
  address: string
  avatarUrl?: string
  contacts: ProfileContact[]
}

/** Changed fields only — sent to PATCH /contacts/{id}/ */
export interface ContactChanges {
  name?: string
  phone?: string
  priority?: number
}

interface Residence {
  id: number
  address: string
  latitude: string
  longitude: string
  created_at: string
}

interface PaginatedResidences {
  count: number
  next: string | null
  previous: string | null
  results: Residence[]
}

interface ContactItem {
  id: number
  name: string
  priority: number
  phone: string
}

interface PaginatedContacts {
  count: number
  next: string | null
  previous: string | null
  results: ContactItem[]
}

function normalizeContact(raw: ContactItem): ProfileContact {
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    priority: Number.isFinite(raw.priority) ? raw.priority : 1,
  }
}

/** Priority 1 first; lowest contact ID breaks ties. */
export function sortContacts(contacts: ProfileContact[]): ProfileContact[] {
  return [...contacts].sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))
}

/** A contact is SMS-eligible when it has a non-empty phone number. */
export function isValidRecipient(contact: ProfileContact): boolean {
  return contact.phone.trim().length > 0
}

/** The contact that receives automatic SMS: lowest numeric priority among valid numbers, lowest ID on ties. */
export function activeRecipient(contacts: ProfileContact[]): ProfileContact | null {
  const sorted = sortContacts(contacts.filter(isValidRecipient))
  return sorted[0] ?? null
}

function normalizeProfile(residence: Residence | null, contacts: ProfileContact[]): ProfileData {
  return {
    firstName: '',
    lastName: '',
    email: '',
    contact: '',
    address: residence?.address ?? '',
    avatarUrl: undefined,
    contacts: sortContacts(contacts),
  }
}

export function fetchProfile(): Promise<ProfileData | null> {
  return cachedFetch(
    PROFILE_CACHE_KEY,
    async () => {
      const residences = await apiGet<PaginatedResidences>(ENDPOINTS.residences)
      const first = residences?.results?.[0]
      if (!first) return null

      const contactsData = await apiGet<PaginatedContacts>(ENDPOINTS.residenceContacts(first.id))
      const contacts = (contactsData?.results ?? []).map(normalizeContact)

      return normalizeProfile(first, contacts)
    },
    { ...CACHE_TTL.profile, persist: true, tags: [CACHE_TAGS.profile] },
  )
}

export async function createContact(contact: Omit<ProfileContact, 'id'>): Promise<ProfileContact> {
  const residences = await apiGet<PaginatedResidences>(ENDPOINTS.residences)
  const first = residences?.results?.[0]
  if (!first) throw new Error('No residence found')

  const priority = Number.isFinite(contact.priority) ? Math.min(5, Math.max(1, Math.round(contact.priority))) : 1
  const data = await apiPost<ContactItem>(ENDPOINTS.residenceContacts(first.id), {
    name: contact.name,
    phone: contact.phone,
    priority,
  })

  invalidateTags([CACHE_TAGS.profile])
  return normalizeContact(data)
}

/** Saves only the changed fields to PATCH /contacts/{id}/ and returns the server-normalized contact. */
export async function updateContact(id: string | number, changes: ContactChanges): Promise<ProfileContact> {
  const data = await apiPatch<ContactItem>(ENDPOINTS.contact(id), changes)
  invalidateTags([CACHE_TAGS.profile])
  return normalizeContact(data)
}

export async function deleteContact(id: string | number): Promise<void> {
  await apiDelete(ENDPOINTS.contact(id))
  invalidateTags([CACHE_TAGS.profile])
}

/** Owner-scoped residence list (Phase 6 — residence management). */
export interface ResidenceEntry {
  id: number
  address: string
  latitude: string | null
  longitude: string | null
  createdAt: string | null
}

export interface ResidenceChanges {
  address?: string
  latitude?: string | null
  longitude?: string | null
}

function normalizeResidence(raw: Residence): ResidenceEntry {
  return {
    id: raw.id,
    address: raw.address ?? '',
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    createdAt: raw.created_at ?? null,
  }
}

export function fetchResidences(): Promise<ResidenceEntry[]> {
  return cachedFetch(
    RESIDENCES_CACHE_KEY,
    async () => {
      const data = await apiGet<PaginatedResidences>(ENDPOINTS.residences)
      return (data?.results ?? []).map(normalizeResidence)
    },
    { ...CACHE_TTL.profile, persist: true, tags: [CACHE_TAGS.profile] },
  )
}

export async function createResidence(changes: ResidenceChanges): Promise<ResidenceEntry> {
  const body: Record<string, unknown> = {}
  if (changes.address !== undefined) body.address = changes.address
  if (changes.latitude !== undefined && changes.latitude !== null && changes.latitude !== '') body.latitude = changes.latitude
  if (changes.longitude !== undefined && changes.longitude !== null && changes.longitude !== '') body.longitude = changes.longitude
  const data = await apiPost<Residence>(ENDPOINTS.residences, body)
  if (!data?.id) throw new Error('Residence creation failed — no residence returned')
  invalidateTags([CACHE_TAGS.profile])
  return normalizeResidence(data)
}

export async function updateResidence(id: number, changes: ResidenceChanges): Promise<ResidenceEntry> {
  const body: Record<string, unknown> = {}
  if (changes.address !== undefined) body.address = changes.address
  if (changes.latitude !== undefined) body.latitude = changes.latitude === '' ? null : changes.latitude
  if (changes.longitude !== undefined) body.longitude = changes.longitude === '' ? null : changes.longitude
  const data = await apiPatch<Residence>(ENDPOINTS.residence(id), body)
  if (!data?.id) throw new Error('Residence update failed — no residence returned')
  invalidateTags([CACHE_TAGS.profile])
  return normalizeResidence(data)
}

/** Destructive: the backend deletes the residence's contacts and unlinks its devices. */
export async function deleteResidence(id: number): Promise<void> {
  await apiDelete(ENDPOINTS.residence(id))
  invalidateTags([CACHE_TAGS.profile, CACHE_TAGS.devices, CACHE_TAGS.settings, CACHE_TAGS.baselines])
}
