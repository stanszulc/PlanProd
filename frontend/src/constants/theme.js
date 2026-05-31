const T = {
  bg:       "#07090c",
  surface:  "#10141a",
  surface2: "#161b24",
  surface3: "#1e2530",
  border:   "rgba(255,255,255,0.08)",
  border2:  "rgba(255,255,255,0.14)",
  text:     "#f0f2f8",
  text2:    "#a8b0c0",
  text3:    "#626d80",
  accent:   "#4d94ff",
  accentBg: "rgba(77,148,255,0.15)",
  ok:       "#34d399",
  okBg:     "rgba(52,211,153,0.14)",
  warn:     "#fbbf24",
  warnBg:   "rgba(251,191,36,0.14)",
  bn:       "#f87171",
  bnBg:     "rgba(248,113,113,0.14)",
  crit:     "#ff4444",
  critBg:   "rgba(255,68,68,0.20)",
  ganttBg:  "#060810",
};

const PALETTE = [
  "#3b82f6","#22c55e","#a855f7","#f59e0b","#06b6d4",
  "#ec4899","#84cc16","#f97316","#6366f1","#14b8a6",
];

export { T, PALETTE };

export function tocColor(zone) {
  switch(zone) {
    case 'green':  return { bg: T.okBg,   border: T.ok,   text: T.ok   };
    case 'yellow': return { bg: T.warnBg, border: T.warn, text: T.warn };
    case 'red':    return { bg: T.bnBg,   border: T.bn,   text: T.bn   };
    case 'black':  return { bg: 'rgba(100,100,100,0.15)', border: T.text3, text: T.text3 };
    default:       return { bg: T.okBg,   border: T.ok,   text: T.ok   };
  }
}



export function uStatus(u) {
  if (u <= 0.85) return { label: "OK",    bg: T.okBg,   text: T.ok,   dot: T.ok };
  if (u <= 1.00) return { label: "UWAGA", bg: T.warnBg, text: T.warn, dot: T.warn };
  if (u <= 1.30) return { label: "BN",    bg: T.bnBg,   text: T.bn,   dot: T.bn };
  return                 { label: "KRYT", bg: T.critBg, text: T.crit, dot: T.crit };
}


export const s = {
  card: {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 12, padding: "20px",
  },
  cardTitle: {
    fontSize: 10, fontWeight: 600, letterSpacing: "0.1em",
    textTransform: "uppercase", color: T.text3, marginBottom: 14,
  },
  badge: (st) => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    background: st.bg, color: st.text,
  }),
  btn: (active) => ({
    padding: "6px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8,
    border: `1px solid ${active ? T.accent : T.border2}`,
    background: active ? T.accentBg : "transparent",
    color: active ? T.accent : T.text2,
    cursor: "pointer", transition: "all 0.15s",
  }),
  btnSm: (active) => ({
    padding: "4px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6,
    border: `1px solid ${active ? T.accent : T.border}`,
    background: active ? T.accentBg : "transparent",
    color: active ? T.accent : T.text2,
    cursor: "pointer",
  }),
  tag: (color) => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 500,
    background: color + "22", color: color,
  }),
};


export const DAY_NAMES = ['Nd','Pon','Wt','Śr','Czw','Pt','Sob'];
