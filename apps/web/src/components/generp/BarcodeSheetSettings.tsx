import {
  formatCm,
  gapsFor,
  parseSheet,
  stickerWidthMm,
  sizeMmCm,
  type BarcodeLabelSettings,
  type BarcodeSheetSpec,
} from '../../lib/generp/barcodeLabels'

type Props = {
  settings: BarcodeLabelSettings
  onChange: (next: BarcodeLabelSettings) => void
}

export function BarcodeSheetSettings({ settings, onChange }: Props) {
  const sheet = parseSheet(settings.sheet)
  const stickerW = stickerWidthMm(sheet)

  const patch = (nextSheet: BarcodeSheetSpec) => {
    onChange({
      ...settings,
      default_layout: 'CUSTOM',
      sheet: nextSheet,
      gaps: {
        ...settings.gaps,
        CUSTOM: { ...gapsFor(settings, 'CUSTOM'), gap_bottom_mm: nextSheet.rowGapMm },
      },
    })
  }

  const setNum = (key: keyof BarcodeSheetSpec, raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    if (key === 'columns') {
      patch({ ...sheet, columns: Math.max(1, Math.min(8, Math.round(n))) })
      return
    }
    patch({ ...sheet, [key]: n })
  }

  return (
    <div className="barcode-sheet-settings">
      <div className="settings-box-title" style={{ fontSize: 12, marginTop: 8 }}>
        Custom template
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        All sizes are millimetres (cm in brackets). Total width is the full strip. Height is one
        sticker. Column gap is space between stickers in the same row. Vertical gap is Bottom in
        Sticker gaps below — leave 0 if the printer skips the liner gap.
      </p>
      <div className="barcode-sheet-grid">
        <label className="settings-field">
          <span>Total width mm (cm)</span>
          <input
            className="input"
            type="number"
            min={20}
            max={400}
            step={0.1}
            value={sheet.totalWidthMm}
            onChange={(e) => setNum('totalWidthMm', e.target.value)}
          />
          <span className="hint">{formatCm(sheet.totalWidthMm)} cm</span>
        </label>
        <label className="settings-field">
          <span>Columns</span>
          <input
            className="input"
            type="number"
            min={1}
            max={8}
            step={1}
            value={sheet.columns}
            onChange={(e) => setNum('columns', e.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Column gap mm (cm)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={40}
            step={0.1}
            value={sheet.columnGapMm}
            onChange={(e) => setNum('columnGapMm', e.target.value)}
          />
          <span className="hint">{formatCm(sheet.columnGapMm)} cm</span>
        </label>
        <label className="settings-field">
          <span>Height mm (cm)</span>
          <input
            className="input"
            type="number"
            min={8}
            max={150}
            step={0.1}
            value={sheet.heightMm}
            onChange={(e) => setNum('heightMm', e.target.value)}
          />
          <span className="hint">{formatCm(sheet.heightMm)} cm</span>
        </label>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        Each sticker: <strong>{sizeMmCm(stickerW, sheet.heightMm)}</strong>
        {' · '}
        {sheet.columns} per row
        {' · '}
        strip {sheet.totalWidthMm} mm ({formatCm(sheet.totalWidthMm)} cm)
      </p>
    </div>
  )
}
