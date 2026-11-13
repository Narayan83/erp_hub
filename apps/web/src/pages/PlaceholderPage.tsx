export function PlaceholderPage({ title, note }: { title: string; note?: string }) {
  return (
    <div className="erp-card">
      <h1 className="h4 text-capitalize">{title}</h1>
      <p className="text-secondary mb-0">{note || 'Screen not migrated yet — mapped in docs/MIGRATION_MAP.md.'}</p>
    </div>
  )
}
