import type { ReactNode } from 'react'
import { DashboardPage } from './pages/DashboardPage'
import {
  LabourMasterPage,
  LedgerMasterPage,
  LocationMasterPage,
  PartnerMasterPage,
  PaymentModeMasterPage,
  PhaseMasterPage,
  VendorMasterPage,
  WorkTypeMasterPage,
} from './pages/masterPages'
import { ProjectsPage } from './pages/ProjectsPage'
import { ChartsPage, LedgerReportPage, SummaryReportPage } from './pages/ReportsPage'
import { TransactionsPage } from './pages/TransactionsPage'

const PAGES: Record<string, () => ReactNode> = {
  dashboard: () => <DashboardPage />,
  cf_projects: () => <ProjectsPage />,
  cf_transactions: () => <TransactionsPage />,
  cf_partner_master: () => <PartnerMasterPage />,
  cf_location_master: () => <LocationMasterPage />,
  cf_phase_master: () => <PhaseMasterPage />,
  cf_work_type_master: () => <WorkTypeMasterPage />,
  cf_labour_master: () => <LabourMasterPage />,
  cf_vendor_master: () => <VendorMasterPage />,
  cf_ledger_master: () => <LedgerMasterPage />,
  cf_payment_mode_master: () => <PaymentModeMasterPage />,
  cf_report_summary: () => <SummaryReportPage />,
  cf_report_ledger: () => <LedgerReportPage />,
  cf_report_charts: () => <ChartsPage />,
}

export function renderContractFarmingMenuPage(raw: string): ReactNode | null {
  const code = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const render = PAGES[code]
  if (!render) return null
  return <div className="cf-root">{render()}</div>
}
