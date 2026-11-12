export type StockMenuMode = {
  voucherType: string
  heading: string
}

/** Sidebar menu code → stock voucher type and page heading. */
export const STOCK_MENU_MODES: Record<string, StockMenuMode> = {
  inward_dc: { voucherType: 'INWARD_DC', heading: 'Inward Delivery Challan' },
  outward_dc: { voucherType: 'OUTWARD_DC', heading: 'Outward Delivery Challan' },
  inward_dc_return: { voucherType: 'INWARD_DC_RETURN', heading: 'Inward DC Return' },
  outward_dc_return: { voucherType: 'OUTWARD_DC_RETURN', heading: 'Outward DC Return' },
  shortage_entry: { voucherType: 'SHORTAGE', heading: 'Shortage Entry' },
  excess_entry: { voucherType: 'EXCESS', heading: 'Excess Entry' },
  wastage_entry: { voucherType: 'WASTAGE', heading: 'Wastage Entry' },
  exchange_entry: { voucherType: 'EXCHANGE', heading: 'Exchange Entry' },
  stock_transfer_out: { voucherType: 'TRANSFER_OUT', heading: 'Stock Transfer to Branch' },
  stock_transfer_in: { voucherType: 'TRANSFER_IN', heading: 'Stock Receive from Branch' },
  stock_conversion: { voucherType: 'CONVERSION', heading: 'Stock Conversion' },
}

export function stockModeFromMenuCode(code: string): StockMenuMode | undefined {
  return STOCK_MENU_MODES[code.trim().toLowerCase()]
}
