import { useState, useMemo } from 'react';
import { T, s } from '../../constants/theme.js';

const STATUS_LABEL = {
  PLAN: { label: 'Zaplanowane', color: T.accent },
  WIP:  { label: 'W trakcie',   color: T.warn  },
  CNF:  { label: 'Wykonane',    color: T.ok    },
  CNC:  { label: 'Anulowane',   color: T.text3 },
};

function fmtDt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt).slice(0,16) || '—';
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0') + ' ' +
    String(d.getHours()).padStart(2,'0') + ':' +
    String(d.getMinutes()).padStart(2,'0');
}

export function RealizacjaTab({ zpStatusData }) {
  const [filterStatus, setFilterStatus] = useState('ALL');

  const filtered = useMemo(() => {
    if (!zpStatusData?.length) return [];
    if (filterStatus === 'ALL') return zpStatusData;
    return zpStatusData.filter(r => r.status === filterStatus);
  }, [zpStatusData, filterStatus]);

  if (!zpStatusData?.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: T.text3 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏭</div>
        <div style={{ fontSize: 14 }}>Brak danych realizacji. Eksportuj ZP → CSV, uzupełnij i wgraj zp_status.csv.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>Realizacja ZP</div>
        <div style={{ fontSize: 11, color: T.text3 }}>{filtered.length} / {zpStatusData.length} rekordów</div>
      </div>

      {/* Filtry */}
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="ALL">Wszystkie statusy</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Tabela — prosta, wszystkie pola */}
      <div style={s.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['zp_id','parent_zp','zs_id','klient','produkt','operacja','gniazdo','seq',
                  'vol plan','vol actual','status','need date',
                  'plan start','plan end','actual start','actual end','reason'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const st = STATUS_LABEL[r.status] || { label: r.status, color: T.text3 };
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : T.surface2 }}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600, color: T.text }}>{r.zp_id}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: T.text3 }}>{r.parent_zp}</td>
                    <td style={{ ...tdStyle, color: T.text2 }}>{r.zs_id}</td>
                    <td style={{ ...tdStyle, color: T.text2 }}>{r.klient}</td>
                    <td style={{ ...tdStyle, color: T.text2 }}>{r.product}</td>
                    <td style={{ ...tdStyle, color: T.text2 }}>{r.operation}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: T.text }}>{r.workcenter}</td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: T.text3 }}>{r.sequence}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{r.volume_plan}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: r.volume_actual > 0 ? T.ok : T.text3 }}>{r.volume_actual}</td>
                    <td style={tdStyle}>
                      <span style={{ ...s.tag(st.color), fontSize: 9 }}>{st.label}</span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: T.text2 }}>{r.need_date}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: T.text3 }}>{fmtDt(r.planned_start)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: T.text3 }}>{fmtDt(r.planned_end)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: r.actual_start ? T.ok : T.text3 }}>{fmtDt(r.actual_start)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: r.actual_end ? T.ok : T.text3 }}>{fmtDt(r.actual_end)}</td>
                    <td style={{ ...tdStyle, fontSize: 10, color: T.warn }}>{r.reason_code || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 7,
  color: T.text, fontSize: 12, padding: '5px 10px', cursor: 'pointer',
};
const thStyle = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em',
  color: T.text3, padding: '6px 8px', borderBottom: `1px solid ${T.border}`,
  textAlign: 'left', whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '6px 8px', borderBottom: `1px solid ${T.border}`,
  color: T.text, whiteSpace: 'nowrap',
};