import {
  BARCODE_LAYOUTS,
  clampGapMm,
  formatCm,
  gapsFor,
  parseSheet,
  type BarcodeGapSettings,
  type BarcodeLabelSettings,
  type BarcodeLayoutId,
} from '../../lib/generp/barcodeLabels'

type Props = {
  settings: BarcodeLabelSettings
  onChange: (next: BarcodeLabelSettings) => void
}

export function BarcodeGapSettings({ settings, onChange }: Props) {
  const setGap = (id: BarcodeLayoutId, patch: Partial<BarcodeGapSettings>) => {
    const nextGaps = {
      ...settings.gaps,
      [id]: { ...gapsFor(settings, id), ...patch },
    }
    const next: BarcodeLabelSettings = { ...settings, gaps: nextGaps }
    if (id === 'CUSTOM' && patch.gap_bottom_mm != null) {
      next.sheet = { ...parseSheet(settings.sheet), rowGapMm: Number(patch.gap_bottom_mm) }
    }
    onChange(next)
  }

  const setNum = (id: BarcodeLayoutId, key: keyof BarcodeGapSettings, raw: string) => {
    const fallback = gapsFor(settings, id)[key]
    const n = clampGapMm(raw, typeof fallback === 'number' ? fallback : 0)
    setGap(id, { [key]: n } as Partial<BarcodeGapSettings>)
  }

  return (
    <div className="barcode-gap-settings">
      <div className="settings-box-title" style={{ fontSize: 12, marginTop: 12 }}>
        Sticker gaps
      </div>
      <p className="hint" style={{ margin: '0 0 8px' }}>
        Values are millimetres (cm in brackets). Left / right inset the print on the sticker.
        Bottom is extra length after each row — <strong>leave 0</strong> on a gap-sensor label
        printer so the tear line matches. Only add mm here if you measured a liner gap the
        printer does not skip.
      </p>
      <table className="data-table mapping-table barcode-gap-table">
        <thead>
          <tr>
            <th>Template</th>
            <th>Left mm (cm)</th>
            <th>Right mm (cm)</th>
            <th>Bottom mm (cm)</th>
            <th>Border</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(BARCODE_LAYOUTS) as BarcodeLayoutId[]).map((id) => {
            const g = gapsFor(settings, id)
            return (
              <tr key={id}>
                <td>{BARCODE_LAYOUTS[id].title}</td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={g.gap_left_mm}
                    onChange={(e) => setNum(id, 'gap_left_mm', e.target.value)}
                  />
                  <span className="hint">{formatCm(g.gap_left_mm)} cm</span>
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={g.gap_right_mm}
                    onChange={(e) => setNum(id, 'gap_right_mm', e.target.value)}
                  />
                  <span className="hint">{formatCm(g.gap_right_mm)} cm</span>
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={g.gap_bottom_mm}
                    onChange={(e) => setNum(id, 'gap_bottom_mm', e.target.value)}
                  />
                  <span className="hint">{formatCm(g.gap_bottom_mm)} cm</span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={g.show_border}
                    onChange={(e) => setGap(id, { show_border: e.target.checked })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
