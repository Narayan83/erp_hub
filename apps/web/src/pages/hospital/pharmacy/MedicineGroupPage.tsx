import { PharmacyPartyMasterPage } from './PharmacyPartyMasterPage'

/** Medicine Group Creation (medicine_group_creation) — code-masters master_type=MG */
export function MedicineGroupPage() {
  return (
    <PharmacyPartyMasterPage
      title="Medicine Group Creation"
      typeCode="MG"
      hint="Create groups, then assign medicines to them from 'Assign Medicine To Group'."
    />
  )
}
