import { useState } from 'react';
import { T, s } from '../../constants/theme.js';
import { DEMO_HISTORY } from '../../constants/demoData.js';

export function ImportTab({ routing, zp, historyData, onLoad }) {
  const [rLoaded,  setRLoaded]  = useState(routing.length > 0);
  const [zsLoaded, setZsLoaded] = useState(false);
  const [hLoaded,  setHLoaded]  = useState(historyData.length > 0);
  const [rejectLog, setRejectLog] = useState([]);

  function readFile(file, type) {
    const reader = new FileReader();
    reader.onload = e => {
      const result = onLoad(e.target.result, type);
      if (type === 'zs')      setZsLoaded(true);
      if (type === 'routing') setRLoaded(true);
      if (type === 'history') {
        setHLoaded(true);
        if (result?.rejected?.length) setRejectLog(result.rejected);
        else setRejectLog([]);
      }
    };
    reader.readAsText(file);
  }

  const DropBox = ({ type, loaded, label, icon, desc, cols }) => (
    <div
      style={{
        border: `1.5px dashed ${loaded ? T.ok : T.border2}`,
        borderRadius: 12, padding: 28, textAlign: 'center',
        background: loaded ? 'rgba(34,197,94,0.05)' : T.surface,
        cursor: 'pointer', transition: 'all 0.2s',
      }}
      onClick={() => document.getElementById(`file_${type}`).click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f, type); }}
    >
      <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: T.text2, marginBottom: 12 }}>{desc}</div>
      {loaded
        ? <div style={{ fontSize: 12, color: T.ok, fontWeight: 600 }}>✓ Załadowano</div>
        : <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {cols.map(c => <span key={c.n} style={{ ...s.tag(c.req ? T.accent : T.text3) }}>{c.n}</span>)}
          </div>
      }
      <input id={`file_${type}`} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; if (f) readFile(f, type); }} />
    </div>
  );

  return (
    <div>
      {/* Pliki planistyczne */}
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.text3, marginBottom: 12 }}>
        Dane planistyczne
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <DropBox type="routing" loaded={rLoaded || routing.length > 0} label="routing.csv" icon="🗂️"
          desc="Definicja operacji per produkt · predecessors: numery seq poprzedników (np. 2|4) dla równoległego WIP"
          cols={[{n:'product',req:true},{n:'operation',req:true},{n:'workcenter',req:true},{n:'ct_min',req:true},{n:'sequence',req:true},{n:'capacity_h',req:false}]} />
        <DropBox type="zs" loaded={zsLoaded} label="zs.csv" icon="🧾"
          desc="Zamówienia sprzedaży z pozycjami"
          cols={[{n:'zs_id',req:true},{n:'pozycja',req:true},{n:'klient',req:false},{n:'product',req:true},{n:'volume',req:true},{n:'due_date',req:true},{n:'priority',req:false}]} />
      </div>

      {/* Plik historyczny */}
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.text3, marginBottom: 12 }}>
        Dane historyczne (opcjonalne)
      </div>
      <div style={{ marginBottom: 24 }}>
        <DropBox type="history" loaded={hLoaded || historyData.length > 0} label="history.csv" icon="📊"
          desc="Rzeczywiste czasy realizacji operacji z MES/ERP — podstawa modułu Analiza Procesu"
          cols={[{n:'zp_id',req:true},{n:'product',req:true},{n:'workcenter',req:true},{n:'operation',req:true},{n:'start_ts',req:true},{n:'end_ts',req:true},{n:'reason_code',req:false}]} />
      </div>

      {/* Log odrzuconych */}
      {rejectLog.length > 0 && (
        <div style={{ background: 'rgba(248,113,113,0.07)', border: `1px solid ${T.bn}`, borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.bn, marginBottom: 8 }}>
            ⚠ Odrzucono {rejectLog.length} rekordów historycznych
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
            {rejectLog.map((r, i) => (
              <div key={i} style={{ fontSize: 11, color: T.text2 }}>
                Linia {r.line}: {r.data.zp_id || '?'} / {r.data.workcenter || '?'} — {r.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Przykłady */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {[
          { title: 'Przykład routing.csv', content: `product,operation,workcenter,ct_min,sequence,capacity_h\nP-KOD,Wycinanie,G-01,3,1,8\nP-KOD,Gięcie,G-02,8,2,8\nP-KOD,Spawanie,G-03,6,3,8` },
          { title: 'Przykład zs.csv',      content: `zs_id,pozycja,klient,product,volume,due_date,priority\nZS-001,1,Kowalski,P-KOD,30,2026-05-25,1\nZS-001,2,Kowalski,P-KOD,20,2026-05-26,1` },
          { title: 'Przykład history.csv', content: `zp_id,product,workcenter,operation,start_ts,end_ts,reason_code\nZP-001,P-KOD,G-01,Wycinanie,2026-05-01 07:00,2026-05-01 07:45,\nZP-001,P-KOD,G-03,Spawanie,2026-05-01 09:10,2026-05-01 11:30,AWARIA` },
        ].map(ex => (
          <div key={ex.title} style={s.card}>
            <div style={s.cardTitle}>{ex.title}</div>
            <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: T.text2, lineHeight: 1.8, overflowX: 'auto', margin: 0 }}>{ex.content}</pre>
          </div>
        ))}
      </div>

      {/* Przyciski demo */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          style={{ padding: '12px 32px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: 'none', background: T.accent, color: '#fff', cursor: 'pointer' }}
          onClick={() => onLoad(null, 'demo')}>
          Załaduj demo (routing + zs)
        </button>
        <button
          style={{ padding: '12px 32px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: `1px solid ${T.border2}`, background: T.surface2, color: T.text, cursor: 'pointer' }}
          onClick={() => {
            const result = onLoad(DEMO_HISTORY, 'history');
            setHLoaded(true);
            if (result?.rejected?.length) setRejectLog(result.rejected);
          }}>
          + Załaduj demo history
        </button>
      </div>
    </div>
  );
}