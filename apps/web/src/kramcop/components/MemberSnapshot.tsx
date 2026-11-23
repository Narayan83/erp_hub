import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Member } from '../types'
import { AuthImage } from './AuthImage'

export function MemberSnapshot({ member, allowPhotoUpload = false }: { member: Member; allowPhotoUpload?: boolean }) {
  const [lang, setLang] = useState<'en' | 'kn'>('en')
  const [hasPhoto, setHasPhoto] = useState(!!member.has_photo)
  const [hasSign, setHasSign] = useState(!!member.has_sign)
  const [photoStamp, setPhotoStamp] = useState(0)
  const [signStamp, setSignStamp] = useState(0)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => {
    setHasPhoto(!!member.has_photo)
    setHasSign(!!member.has_sign)
    setPhotoStamp(0)
    setSignStamp(0)
    setUploadError('')
  }, [member.id, member.has_photo, member.has_sign])
  const kn = lang === 'kn'
  const name = kn ? member.name_kn || member.name_en : member.name_en || member.name_kn
  const village = kn ? member.village_kn || member.village_en : member.village_en || member.village_kn
  const post = kn ? member.post_kn || member.post_en : member.post_en || member.post_kn
  const taluk = kn ? member.taluk_kn || member.taluk_en : member.taluk_en || member.taluk_kn
  const dist = kn ? member.dist_kn || member.dist_en : member.dist_en || member.dist_kn
  const phone = member.mobile || member.phone || '—'

  const uploadFile = async (kind: 'photo' | 'sign', file: File | undefined) => {
    if (!file) return
    setUploadError('')
    try {
      await api.upload(`/members/${member.id}/${kind}`, file)
      if (kind === 'photo') {
        setHasPhoto(true)
        setPhotoStamp(Date.now())
      } else {
        setHasSign(true)
        setSignStamp(Date.now())
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return (
    <div className="member-snap">
      <div className="snap-body">
        <div className="snap-head">
          <strong>
            ACNO {member.acno} · {name}
          </strong>
          <button className="btn" type="button" onClick={() => setLang((l) => (l === 'en' ? 'kn' : 'en'))}>
            {kn ? 'English' : 'Kannada'}
          </button>
        </div>
        <div className={`snap-addr ${kn ? 'kn' : ''}`}>
          <div>Phone: {phone}{member.phone && member.mobile && member.phone !== member.mobile ? ` / ${member.phone}` : ''}</div>
          <div>AT: {village || '—'} · PO: {post || '—'}</div>
          <div>
            TQ: {taluk || '—'} · DIST: {dist || '—'}
            {member.pin ? ` · PIN ${member.pin}` : ''}
          </div>
        </div>
      </div>
      <div className="snap-media">
        <div className="snap-slot">
          {hasPhoto ? (
            <AuthImage key={`p-${member.id}-${photoStamp}`} path={`/members/${member.id}/photo`} alt="Photo" className="snap-photo" />
          ) : (
            <div className="photo-ph">Photo</div>
          )}
          {allowPhotoUpload && (
            <label className="snap-upload">
              Upload photo
              <input type="file" accept="image/*" onChange={(e) => void uploadFile('photo', e.target.files?.[0])} />
            </label>
          )}
        </div>
        <div className="snap-slot">
          {hasSign ? (
            <AuthImage key={`s-${member.id}-${signStamp}`} path={`/members/${member.id}/sign`} alt="Signature" className="snap-sign" />
          ) : (
            <div className="photo-ph sign">Sign</div>
          )}
          {allowPhotoUpload && (
            <label className="snap-upload">
              Upload sign
              <input type="file" accept="image/*" onChange={(e) => void uploadFile('sign', e.target.files?.[0])} />
            </label>
          )}
        </div>
      </div>
      {uploadError && <div className="snap-upload-error">{uploadError}</div>}
    </div>
  )
}
