import { useState } from 'react'
import type { Member } from '../types'
import { AuthImage } from './AuthImage'

export function MemberSnapshot({ member }: { member: Member }) {
  const [lang, setLang] = useState<'en' | 'kn'>('en')
  const kn = lang === 'kn'
  const name = kn ? member.name_kn || member.name_en : member.name_en || member.name_kn
  const village = kn ? member.village_kn || member.village_en : member.village_en || member.village_kn
  const post = kn ? member.post_kn || member.post_en : member.post_en || member.post_kn
  const taluk = kn ? member.taluk_kn || member.taluk_en : member.taluk_en || member.taluk_kn
  const dist = kn ? member.dist_kn || member.dist_en : member.dist_en || member.dist_kn
  const phone = member.mobile || member.phone || '—'

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
        {member.has_photo ? (
          <AuthImage path={`/members/${member.id}/photo`} alt="Photo" className="snap-photo" />
        ) : (
          <div className="photo-ph">Photo</div>
        )}
        {member.has_sign ? (
          <AuthImage path={`/members/${member.id}/sign`} alt="Signature" className="snap-sign" />
        ) : (
          <div className="photo-ph sign">Sign</div>
        )}
      </div>
    </div>
  )
}
