import { T, s } from '../../constants/theme.js';

export function Bar({ value, max = 1, color, height = 6 }) {
  const utilPct = value / max;
  const displayPct = Math.min(utilPct * 100, 100);
  const isOverloaded = utilPct > 1.0;

  return (
    <div style={{ height, borderRadius: 3, background: T.border2, overflow: "hidden", flex: 1, minWidth: 60, position: "relative" }}>
      <div style={{ height: "100%", width: `${displayPct}%`, background: isOverloaded ? `linear-gradient(90deg, ${color} 70%, #dc2626 100%)` : color, borderRadius: 3, transition: "width 0.4s" }} />
      {isOverloaded && (
        <div style={{
          position: "absolute", right: 0, top: 0, width: "15%", height: "100%",
          background: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 4px)"
        }} />
      )}
    </div>
  );
}
