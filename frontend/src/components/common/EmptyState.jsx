import { T, s } from '../../constants/theme.js';

export function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px" }}>
      <div style={{ fontSize: 44, marginBottom: 16, opacity: 0.4 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: T.text2 }}>{sub}</div>
    </div>
  );
}

// ─── ZAKŁADKA: IMPORT ────────────────────────────────────────────────────────
const DAY_NAMES = ['Nd','Pon','Wt','Śr','Czw','Pt','Sob'];