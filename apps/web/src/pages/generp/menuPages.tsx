import type { ReactNode } from 'react'
import { PageErrorBoundary } from '../../components/generp/PageErrorBoundary'
import { DashboardPage } from './DashboardPage'
import { DashboardShortcutsPage } from './DashboardShortcutsPage'
import { PlaceholderPage } from './PlaceholderPage'
import { SaleBillModifyPage, SaleBillReprintPage, WholesaleBillModifyPage, WholesaleBillReprintPage } from './SaleBillModifyPage'
import { SaleBillPage, WHOLESALE_BILL_MODE } from './SaleBillPage'
import { BarcodeGenerationPage } from './BarcodeGenerationPage'
import { PrintMasterPage } from './PrintMasterPage'
import { CompanyProfilePage } from './CompanyProfilePage'
import { DailyCollectionReportPage } from './DailyCollectionReportPage'
import { TaxwiseBillSummaryPage, TaxwiseSummaryPage } from './TaxwiseReportPage'
import { ProductCreationPage } from './ProductCreationPage'
import { CustomerMasterPage, VendorMasterPage } from './PartyMasterPage'
import { ShoppingCartPage } from './ShoppingCartPage'
import { ShoppingBannerPage } from './ShoppingBannerPage'
import { ShoppingAnalyticsPage } from './ShoppingAnalyticsPage'
import { SaleBillSettingsPage } from './SaleBillSettingsPage'
import { BillPrefixPage } from './BillPrefixPage'
import { LedgerMasterPage } from './LedgerMasterPage'
import { AdvanceCollectionPage } from './AdvanceCollectionPage'
import { ContraEntryPage, PaymentAdjustmentPage } from './PaymentAdjustmentPage'
import {
  CashBookPage,
  CashbookLedgerViewPage,
  DaybookPage,
  LedgerDetailsPage,
} from './AccountingReportsPage'
import {
  BalanceSheetPage,
  ProfitAndLossPage,
  ReceiptPaymentReportPage,
  TrialBalancePage,
} from './FinancialReportsPage'
import { RoleMenuPermissionsPage } from './RoleMenuPermissionsPage'
import { UserMasterPage } from './UserMasterPage'
import { AuditTrailPage } from './AuditTrailPage'
import { BranchMasterPage } from './BranchMasterPage'
import { DiscountMasterPage } from './DiscountMasterPage'
import { GstCreationPage } from './GstCreationPage'
import { PurchaseOrderPage, SalesOrderPage } from './OrderPage'
import { StockBalancesPage } from './StockBalancesPage'
import { StockLedgerPage } from './StockLedgerPage'
import {
  ExchangeEntryPage,
  ExcessEntryPage,
  InwardDcPage,
  InwardDcReturnPage,
  OutwardDcPage,
  OutwardDcReturnPage,
  ShortageEntryPage,
  StockConversionPage,
  StockTransferInPage,
  StockTransferOutPage,
  WastageEntryPage,
} from './StockVoucherPage'
import {
  PurchaseReturnPage,
  SalesReturnPage,
} from './TradingVoucherPage'
import { LotMasterPage } from './LotMasterPage'
import { PurchaseBillPage } from './PurchaseBillPage'
import { StockDetailReportsPage } from './StockDetailReportsPage'
import { PurchaseBillDetailsPage } from './PurchaseBillDetailsPage'
import {
  CustomerDetailsPage,
  CustomerSchedulePage,
  SupplierDetailsPage,
  SupplierSchedulePage,
} from './PartySchedulePage'

/** Resolve a sidebar / shortcut menu code to the page component. */
export function renderGenerpMenuPage(raw: string): ReactNode {
  const code = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')

  let page: ReactNode
  switch (code) {
    case 'dashboard':
      page = <DashboardPage />
      break
    case 'dashboard_shortcuts':
      page = <DashboardShortcutsPage />
      break
    case 'sale_bill':
      page = <SaleBillPage />
      break
    case 'sale_bill_modify':
      page = <SaleBillModifyPage />
      break
    case 'sale_bill_reprint':
      page = <SaleBillReprintPage />
      break
    case 'wholesale_bill':
      page = <SaleBillPage mode={WHOLESALE_BILL_MODE} />
      break
    case 'wholesale_bill_modify':
      page = <WholesaleBillModifyPage />
      break
    case 'wholesale_bill_reprint':
      page = <WholesaleBillReprintPage />
      break
    case 'sale_bill_settings':
      page = <SaleBillSettingsPage />
      break
    case 'bill_prefix':
      page = <BillPrefixPage />
      break
    case 'print_master':
      page = <PrintMasterPage />
      break
    case 'company_profile':
      page = <CompanyProfilePage />
      break
    case 'lot_master':
      page = <LotMasterPage />
      break
    case 'daily_collection_report':
      page = <DailyCollectionReportPage />
      break
    case 'taxwise_bill_summary':
      page = <TaxwiseBillSummaryPage />
      break
    case 'taxwise_summary':
      page = <TaxwiseSummaryPage />
      break
    case 'product_creation':
    case 'product_master':
      page = <ProductCreationPage />
      break
    case 'customer_creation':
    case 'customer_list':
      page = <CustomerMasterPage />
      break
    case 'vendor_creation':
    case 'vendor_list':
      page = <VendorMasterPage />
      break
    case 'barcode_generation':
      page = <BarcodeGenerationPage />
      break

    case 'ledger_master':
      page = <LedgerMasterPage />
      break
    case 'advance_collection':
      page = <AdvanceCollectionPage />
      break
    case 'adjustment_entry':
      page = <PaymentAdjustmentPage />
      break
    case 'contra_entry':
    case 'receipt_voucher_adjustment_entry':
      page = <ContraEntryPage />
      break
    case 'ledger_details':
      page = <LedgerDetailsPage />
      break
    case 'cash_book':
      page = <CashBookPage />
      break
    case 'cashbook':
      page = <CashbookLedgerViewPage />
      break
    case 'daybook':
      page = <DaybookPage />
      break
    case 'receipt_payment_report':
      page = <ReceiptPaymentReportPage />
      break
    case 'trial_balance':
      page = <TrialBalancePage />
      break
    case 'profit_and_loss':
      page = <ProfitAndLossPage />
      break
    case 'balance_sheet':
      page = <BalanceSheetPage />
      break
    case 'role_menu_permissions':
      page = <RoleMenuPermissionsPage />
      break
    case 'user_addition_modification':
      page = <UserMasterPage />
      break
    case 'audit_trail':
      page = <AuditTrailPage />
      break

    case 'discount_master':
      page = <DiscountMasterPage />
      break
    case 'gst_creation':
      page = <GstCreationPage />
      break

    case 'branch_master':
      page = <BranchMasterPage />
      break
    case 'inward_dc':
      page = <InwardDcPage />
      break
    case 'outward_dc':
      page = <OutwardDcPage />
      break
    case 'inward_dc_return':
      page = <InwardDcReturnPage />
      break
    case 'outward_dc_return':
      page = <OutwardDcReturnPage />
      break
    case 'shortage_entry':
      page = <ShortageEntryPage />
      break
    case 'excess_entry':
      page = <ExcessEntryPage />
      break
    case 'wastage_entry':
      page = <WastageEntryPage />
      break
    case 'exchange_entry':
      page = <ExchangeEntryPage />
      break
    case 'stock_conversion':
      page = <StockConversionPage />
      break
    case 'stock_transfer_out':
      page = <StockTransferOutPage />
      break
    case 'stock_transfer_in':
      page = <StockTransferInPage />
      break
    case 'stock_ledger':
      page = <StockLedgerPage />
      break
    case 'stock_balances':
      page = <StockBalancesPage />
      break

    case 'sales_return':
      page = <SalesReturnPage />
      break
    case 'purchase_bill':
      page = <PurchaseBillPage />
      break
    case 'purchase_bill_details':
    case 'purchasebill_details':
      page = <PurchaseBillDetailsPage />
      break
    case 'purchase_return':
      page = <PurchaseReturnPage />
      break
    case 'supplier_schedule':
      page = <SupplierSchedulePage />
      break
    case 'supplier_details':
      page = <SupplierDetailsPage />
      break
    case 'barcode_stock_report':
      page = <StockDetailReportsPage mode="barcode" />
      break
    case 'item_stock_report':
      page = <StockDetailReportsPage mode="item" />
      break
    case 'stock_movement_report':
      page = <StockDetailReportsPage mode="movement" />
      break
    case 'sundry_debtors_list':
      page = <CustomerSchedulePage />
      break
    case 'sundry_debtors_details':
      page = <CustomerDetailsPage />
      break
    case 'sales_order':
      page = <SalesOrderPage />
      break
    case 'purchase_order':
      page = <PurchaseOrderPage />
      break
    case 'shopping_cart':
      page = <ShoppingCartPage />
      break
    case 'shopping_banner':
      page = <ShoppingBannerPage />
      break
    case 'shopping_analytics':
      page = <ShoppingAnalyticsPage />
      break

    default:
      page = <PlaceholderPage code={raw || code} />
  }

  return <PageErrorBoundary title={code}>{page}</PageErrorBoundary>
}

export function prettyMenuTitle(code: string) {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
