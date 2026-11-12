import { JournalEntryPage } from './JournalEntryPage'

export function PaymentAdjustmentPage() {
  return <JournalEntryPage variant="receipt_payment" />
}

export function ContraEntryPage() {
  return <JournalEntryPage variant="contra" />
}
