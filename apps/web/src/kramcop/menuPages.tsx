import type { ReactNode } from 'react'
import { AuditPage } from './pages/AuditPage'
import { CategoryMasterPage } from './pages/CategoryMasterPage'
import { CategoryMembersPage } from './pages/CategoryMembersPage'
import { CustomerMasterPage } from './pages/CustomerMasterPage'
import { DashboardPage } from './pages/DashboardPage'
import { LabelsPage } from './pages/LabelsPage'
import { RolesPage } from './pages/RolesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShareSchedulePage } from './pages/ShareSchedulePage'
import { ShareSummaryPage } from './pages/ShareSummaryPage'
import { ShareTypeMasterPage } from './pages/ShareTypeMasterPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { UsersPage } from './pages/UsersPage'

const PAGES: Record<string, () => ReactNode> = {
  dashboard: () => <DashboardPage />,
  customer_master: () => <CustomerMasterPage />,
  category_master: () => <CategoryMasterPage />,
  share_type_master: () => <ShareTypeMasterPage />,
  share_entry: () => <TransactionsPage />,
  share_schedule: () => <ShareSchedulePage />,
  share_summary: () => <ShareSummaryPage />,
  address_labels: () => <LabelsPage />,
  category_members: () => <CategoryMembersPage />,
  user_addition_modification: () => <UsersPage />,
  kc_roles: () => <RolesPage />,
  kc_audit: () => <AuditPage />,
  society_profile: () => <SettingsPage />,
}

/** Society screens. Shared menus (company, ledgers, print) stay with the platform. */
export function renderKramcopMenuPage(raw: string): ReactNode | null {
  const code = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const render = PAGES[code]
  if (!render) return null
  return <div className="kc-root">{render()}</div>
}
