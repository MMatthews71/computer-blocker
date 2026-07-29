export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="stat-value">{value}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}
