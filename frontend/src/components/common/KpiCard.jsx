import { T, s } from '../../constants/theme.js';

export function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ ...s.card, padding: "16px 18px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.text3, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", color: color || T.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: T.text2, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}
