import { T, s } from '../../constants/theme.js';

export function DatePicker({ dates, selected, onChange, label = "Termin:" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <span style={{ fontSize: 12, color: T.text3 }}>{label}</span>
      {dates.map(d => (
        <button key={d} style={s.btnSm(d === selected)} onClick={() => onChange(d)}>{d}</button>
      ))}
    </div>
  );
}
