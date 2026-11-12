import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { handleEnterAsTab } from '../../lib/generp/enterAsTab'
import { DEFAULT_STATE, INDIAN_STATES } from '../../lib/generp/indianStates'
import type { Party } from '../../generpTypes'
import { ImageCropModal } from './ImageCropModal'

export type PartyFormState = {
  name: string
  contact_person: string
  phone: string
  email: string
  gstin: string
  is_customer: boolean
  is_vendor: boolean
  address_line1: string
  address_line2: string
  address_line3: string
  address_line4: string
  city: string
  state: string
  pin_code: string
  same_as_billing: boolean
  shipping_address_line1: string
  shipping_address_line2: string
  shipping_address_line3: string
  shipping_address_line4: string
  shipping_city: string
  shipping_state: string
  shipping_pin_code: string
  image_url: string
  image_blob: Blob | null
  remove_image: boolean
}

const emptyShipping = {
  shipping_address_line1: '',
  shipping_address_line2: '',
  shipping_address_line3: '',
  shipping_address_line4: '',
  shipping_city: '',
  shipping_state: DEFAULT_STATE,
  shipping_pin_code: '',
}

export const EMPTY_PARTY_FORM: PartyFormState = {
  name: '',
  contact_person: '',
  phone: '',
  email: '',
  gstin: '',
  is_customer: true,
  is_vendor: false,
  address_line1: '',
  address_line2: '',
  address_line3: '',
  address_line4: '',
  city: '',
  state: DEFAULT_STATE,
  pin_code: '',
  same_as_billing: true,
  ...emptyShipping,
  image_url: '',
  image_blob: null,
  remove_image: false,
}

export function emptyPartyForm(partial?: Partial<PartyFormState>): PartyFormState {
  return { ...EMPTY_PARTY_FORM, ...partial }
}

export function partyRolesToType(form: Pick<PartyFormState, 'is_customer' | 'is_vendor'>): 'customer' | 'vendor' | 'both' {
  if (form.is_customer && form.is_vendor) return 'both'
  if (form.is_vendor && !form.is_customer) return 'vendor'
  return 'customer'
}

export function partyMatchesType(partyType: string | undefined, wanted: 'customer' | 'vendor') {
  if (partyType === 'both') return true
  return partyType === wanted
}

function shippingFromBilling(form: PartyFormState) {
  return {
    shipping_address_line1: form.address_line1,
    shipping_address_line2: form.address_line2,
    shipping_address_line3: form.address_line3,
    shipping_address_line4: form.address_line4,
    shipping_city: form.city,
    shipping_state: form.state,
    shipping_pin_code: form.pin_code,
  }
}

export function partyToForm(p: Party): PartyFormState {
  const isCustomer = p.party_type === 'customer' || p.party_type === 'both' || !p.party_type
  const isVendor = p.party_type === 'vendor' || p.party_type === 'both'
  const same = p.same_as_billing !== false
  const form: PartyFormState = {
    name: String(p.name || ''),
    contact_person: String(p.contact_person || ''),
    phone: String(p.phone || ''),
    email: String(p.email || ''),
    gstin: String(p.gstin || ''),
    is_customer: isCustomer,
    is_vendor: isVendor,
    address_line1: String(p.address_line1 || ''),
    address_line2: String(p.address_line2 || ''),
    address_line3: String(p.address_line3 || ''),
    address_line4: String(p.address_line4 || ''),
    city: String(p.city || ''),
    state: String(p.state || '') || DEFAULT_STATE,
    pin_code: String(p.pin_code || ''),
    same_as_billing: same,
    shipping_address_line1: String(p.shipping_address_line1 || ''),
    shipping_address_line2: String(p.shipping_address_line2 || ''),
    shipping_address_line3: String(p.shipping_address_line3 || ''),
    shipping_address_line4: String(p.shipping_address_line4 || ''),
    shipping_city: String(p.shipping_city || ''),
    shipping_state: String(p.shipping_state || '') || DEFAULT_STATE,
    shipping_pin_code: String(p.shipping_pin_code || ''),
    image_url: String(p.image_url || ''),
    image_blob: null,
    remove_image: false,
  }
  if (same) {
    Object.assign(form, shippingFromBilling(form))
  }
  return form
}

export function partySavePayload(form: PartyFormState) {
  const blank = (v: string) => v.trim() || null
  const shipping = form.same_as_billing ? shippingFromBilling(form) : form
  return {
    name: form.name.trim(),
    party_type: partyRolesToType(form),
    contact_person: blank(form.contact_person),
    phone: blank(form.phone),
    email: blank(form.email),
    gstin: blank(form.gstin),
    address_line1: blank(form.address_line1),
    address_line2: blank(form.address_line2),
    address_line3: blank(form.address_line3),
    address_line4: blank(form.address_line4),
    city: blank(form.city),
    state: blank(form.state) || DEFAULT_STATE,
    pin_code: blank(form.pin_code),
    same_as_billing: form.same_as_billing,
    shipping_address_line1: blank(shipping.shipping_address_line1),
    shipping_address_line2: blank(shipping.shipping_address_line2),
    shipping_address_line3: blank(shipping.shipping_address_line3),
    shipping_address_line4: blank(shipping.shipping_address_line4),
    shipping_city: blank(shipping.shipping_city),
    shipping_state: blank(shipping.shipping_state) || DEFAULT_STATE,
    shipping_pin_code: blank(shipping.shipping_pin_code),
    opening_balance: 0,
    opening_type: form.is_vendor && !form.is_customer ? 'Cr' : 'Dr',
  }
}

export async function persistPartyImage(partyId: string, form: PartyFormState): Promise<Party | null> {
  if (form.image_blob) {
    const fd = new FormData()
    fd.append('file', new File([form.image_blob], 'party.jpg', { type: 'image/jpeg' }))
    return api.upload<Party>(`/parties/${partyId}/image`, fd)
  }
  if (form.remove_image) {
    return api.delete<Party>(`/parties/${partyId}/image`)
  }
  return null
}

export async function savePartyRecord(form: PartyFormState, editId: string | null): Promise<Party> {
  if (!form.is_customer && !form.is_vendor) {
    throw new Error('Select Customer, Supplier, or both.')
  }
  const payload = partySavePayload(form)
  const party = editId
    ? await api.patch<Party>(`/parties/${editId}`, payload)
    : await api.post<Party>('/parties', payload)
  const withImage = await persistPartyImage(party.id, form)
  return withImage || party
}

type Props = {
  form: PartyFormState
  onChange: (next: PartyFormState) => void
  compact?: boolean
}

function StateSelect({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const extra = value && !INDIAN_STATES.includes(value as (typeof INDIAN_STATES)[number])
  return (
    <select
      className="input"
      autoComplete="off"
      value={value || DEFAULT_STATE}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {extra ? <option value={value}>{value}</option> : null}
      {INDIAN_STATES.map((st) => (
        <option key={st} value={st}>
          {st}
        </option>
      ))}
    </select>
  )
}

type AddrKeys = {
  line1: keyof PartyFormState
  line2: keyof PartyFormState
  line3: keyof PartyFormState
  line4: keyof PartyFormState
  city: keyof PartyFormState
  state: keyof PartyFormState
  pin: keyof PartyFormState
}

function AddressBlock({
  title,
  extra,
  disabled,
  form,
  set,
  keys,
}: {
  title: string
  extra?: ReactNode
  disabled?: boolean
  form: PartyFormState
  set: (key: keyof PartyFormState) => (value: string) => void
  keys: AddrKeys
}) {
  const text = (key: keyof PartyFormState) => String(form[key] ?? '')
  return (
    <div className="party-addr-col">
      <div className="party-addr-head">
        <div className="party-addr-title">{title}</div>
        {extra}
      </div>
      <label className="settings-field">
        <span>Address line 1</span>
        <input className="input" value={text(keys.line1)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.line1)(e.target.value)} />
      </label>
      <label className="settings-field">
        <span>Address line 2</span>
        <input className="input" value={text(keys.line2)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.line2)(e.target.value)} />
      </label>
      <label className="settings-field">
        <span>Address line 3</span>
        <input className="input" value={text(keys.line3)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.line3)(e.target.value)} />
      </label>
      <label className="settings-field">
        <span>Address line 4</span>
        <input className="input" value={text(keys.line4)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.line4)(e.target.value)} />
      </label>
      <div className="settings-field-row settings-field-row--3">
        <label className="settings-field">
          <span>City</span>
          <input className="input" value={text(keys.city)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.city)(e.target.value)} />
        </label>
        <label className="settings-field">
          <span>State</span>
          <StateSelect value={text(keys.state)} disabled={disabled} onChange={set(keys.state)} />
        </label>
        <label className="settings-field">
          <span>PIN</span>
          <input className="input" value={text(keys.pin)} autoComplete="off" disabled={disabled} onChange={(e) => set(keys.pin)(e.target.value)} />
        </label>
      </div>
    </div>
  )
}

export function PartyDetailsForm({ form, onChange, compact }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    if (!form.image_blob) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(form.image_blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [form.image_blob])

  const patch = (partial: Partial<PartyFormState>) => {
    const next = { ...form, ...partial }
    if (next.same_as_billing) {
      Object.assign(next, shippingFromBilling(next))
    }
    onChange(next)
  }

  const set =
    (key: keyof PartyFormState) =>
    (value: string) => {
      patch({ [key]: value })
    }

  const shownImage = previewUrl || (!form.remove_image ? form.image_url : '')

  return (
    <div
      ref={rootRef}
      className={`party-form${compact ? ' is-compact' : ''}`}
      onKeyDown={(e) => {
        const scope = rootRef.current?.closest<HTMLElement>('.party-enter-root') ?? rootRef.current
        handleEnterAsTab(e, scope)
      }}
    >
      <div className="party-form-top">
        <div className="party-photo">
          <div className={`party-photo-frame${shownImage ? '' : ' is-empty'}`}>
            {shownImage ? <img src={shownImage} alt="Customer" /> : <span>No photo</span>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) setCropFile(file)
            }}
          />
          <div className="party-photo-actions">
            <button
              type="button"
              className="btn"
              data-skip-enter="true"
              onClick={() => fileRef.current?.click()}
            >
              {shownImage ? 'Change' : 'Add photo'}
            </button>
            {shownImage ? (
              <button
                type="button"
                className="btn"
                data-skip-enter="true"
                onClick={() =>
                  patch({
                    image_blob: null,
                    image_url: '',
                    remove_image: Boolean(form.image_url),
                  })
                }
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <div className="party-form-fields">
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Name *</span>
              <input
                className="input"
                value={form.name}
                autoComplete="off"
                autoFocus
                onChange={(e) => set('name')(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Mobile</span>
              <input className="input" value={form.phone} autoComplete="off" onChange={(e) => set('phone')(e.target.value)} />
            </label>
          </div>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>Contact person</span>
              <input
                className="input"
                value={form.contact_person}
                autoComplete="off"
                onChange={(e) => set('contact_person')(e.target.value)}
              />
            </label>
            <label className="settings-field">
              <span>Email</span>
              <input
                className="input"
                type="text"
                inputMode="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => set('email')(e.target.value)}
              />
            </label>
          </div>
          <div className="settings-field-row">
            <label className="settings-field">
              <span>GSTIN</span>
              <input className="input" value={form.gstin} autoComplete="off" onChange={(e) => set('gstin')(e.target.value)} />
            </label>
            <div className="settings-field">
              <span>Type</span>
              <div className="party-roles">
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_customer}
                    onChange={(e) => patch({ is_customer: e.target.checked })}
                  />
                  Customer
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_vendor}
                    onChange={(e) => patch({ is_vendor: e.target.checked })}
                  />
                  Supplier/Vendor
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="party-addr-grid">
        <AddressBlock
          title="Billing address"
          form={form}
          set={set}
          keys={{
            line1: 'address_line1',
            line2: 'address_line2',
            line3: 'address_line3',
            line4: 'address_line4',
            city: 'city',
            state: 'state',
            pin: 'pin_code',
          }}
        />
        <AddressBlock
          title="Shipping address"
          disabled={form.same_as_billing}
          extra={
            <label className="party-same-as">
              <input
                type="checkbox"
                checked={form.same_as_billing}
                onChange={(e) => {
                  const checked = e.target.checked
                  if (checked) patch({ same_as_billing: true, ...shippingFromBilling(form) })
                  else patch({ same_as_billing: false })
                }}
              />
              Same as above
            </label>
          }
          form={form}
          set={set}
          keys={{
            line1: 'shipping_address_line1',
            line2: 'shipping_address_line2',
            line3: 'shipping_address_line3',
            line4: 'shipping_address_line4',
            city: 'shipping_city',
            state: 'shipping_state',
            pin: 'shipping_pin_code',
          }}
        />
      </div>

      {cropFile
        ? createPortal(
            <ImageCropModal
              file={cropFile}
              title={form.name || 'Photo'}
              onConfirm={(blob) => {
                patch({ image_blob: blob, remove_image: false })
                setCropFile(null)
              }}
              onCancel={() => setCropFile(null)}
            />,
            document.body,
          )
        : null}
    </div>
  )
}
