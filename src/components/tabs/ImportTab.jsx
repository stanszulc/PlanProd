import { useState } from 'react';
import { T, s } from '../../constants/theme.js';
import { DEMO_HISTORY } from '../../constants/demoData.js';

function dlCSV(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

const SAMPLE_CSVS = {
  routing: {
    filename: 'routing_przyklad.csv',
    content: `product,operation,workcenter,ct_min,sequence,capacity_h,predecessors
P-KOD-100-100,Wycinanie laserowe podstawy,G-01,3.0,1,8,
P-KOD-100-100,Gięcie profili podstawy,G-02,8.0,2,8,1
P-KOD-100-100,Spawanie narożników korpusu,G-03,6.0,3,8,
P-KOD-100-100,Izolacja PIR i montaż poliwęglanu,G-04,12.0,4,8,3
P-KOD-100-100,Montaż siłownika i testy KJ,G-05,15.0,5,8,2|4
P-SKR-ROZ-02,Wycinanie obudowy skrzynki,G-01,1.0,1,8,
P-SKR-ROZ-02,Gięcie skrzynki,G-02,2.0,2,8,
P-SKR-ROZ-02,Zgrzewanie liniowe korpusu,G-03,2.0,3,8,
P-SKR-ROZ-02,Wyklejanie matą kauczukową,G-04,5.0,4,8,
P-SKR-ROZ-02,Montaż króćców i przepustnicy,G-05,4.0,5,8,`,
  },
  zs: {
    filename: 'zs_przyklad.csv',
    content: `zs_id,pozycja,klient,product,volume,due_date,priority
ZS-001,1,Klima-Tech Sp. z o.o.,P-KOD-100-100,30,2026-05-25,1
ZS-001,2,Klima-Tech Sp. z o.o.,P-KOD-100-100,20,2026-05-26,1
ZS-002,1,VentPro S.A.,P-SKR-ROZ-02,50,2026-05-25,2
ZS-002,2,VentPro S.A.,P-SKR-ROZ-02,40,2026-05-26,2`,
  },
  history: {
    filename: 'history_przyklad.csv',
    content: `zp_id,product,workcenter,operation,start_ts,end_ts,volume,reason_code
ZP-001,P-KOD-100-100,G-01,Wycinanie laserowe podstawy,2026-05-01 07:00,2026-05-01 07:45,30,
ZP-001,P-KOD-100-100,G-02,Gięcie profili podstawy,2026-05-01 08:10,2026-05-01 09:30,30,
ZP-001,P-KOD-100-100,G-03,Spawanie narożników korpusu,2026-05-01 10:05,2026-05-01 11:50,30,AWARIA
ZP-001,P-KOD-100-100,G-04,Izolacja PIR i montaż poliwęglanu,2026-05-01 12:00,2026-05-01 14:00,30,
ZP-001,P-KOD-100-100,G-05,Montaż siłownika i testy KJ,2026-05-01 14:30,2026-05-01 16:30,30,
ZP-002,P-SKR-ROZ-02,G-01,Wycinanie obudowy skrzynki,2026-05-02 07:00,2026-05-02 07:20,50,
ZP-002,P-SKR-ROZ-02,G-02,Gięcie skrzynki,2026-05-02 08:00,2026-05-02 08:40,50,PRZEZBROJENIE
ZP-002,P-SKR-ROZ-02,G-03,Zgrzewanie liniowe korpusu,2026-05-02 09:15,2026-05-02 10:00,50,
ZP-002,P-SKR-ROZ-02,G-04,Wyklejanie matą kauczukową,2026-05-02 10:30,2026-05-02 12:00,50,BRAK_MATERIALU
ZP-002,P-SKR-ROZ-02,G-05,Montaż króćców i przepustnicy,2026-05-02 12:30,2026-05-02 13:30,50,`,
  },
  schedule_hist: {
    filename: 'schedule_hist_przyklad.csv',
    content: `workcenter,date,planned_h,shift
G-01,2026-05-01,8,1
G-02,2026-05-01,8,1
G-03,2026-05-01,16,2
G-04,2026-05-01,8,1
G-05,2026-05-01,8,1
G-01,2026-05-02,8,1
G-02,2026-05-02,16,2
G-03,2026-05-02,0,0
G-04,2026-05-02,8,1
G-05,2026-05-02,8,1
G-01,2026-05-03,0,0
G-02,2026-05-03,0,0
G-03,2026-05-03,0,0
G-04,2026-05-03,0,0
G-05,2026-05-03,0,0`,
  },
};

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

      {/* Przykłady + pobieranie */}
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.text3, marginBottom: 12 }}>
        Przykładowe pliki CSV
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { key: 'routing',       label: 'routing.csv',       icon: '🗂️', desc: 'Marszruty technologiczne · operacje · czasy cyklu' },
          { key: 'zs',            label: 'zs.csv',            icon: '🧾', desc: 'Zamówienia sprzedaży · klienci · terminy' },
          { key: 'history',       label: 'history.csv',       icon: '📊', desc: 'Historia operacji · timestampy · reason codes · wolumen' },
          { key: 'schedule_hist', label: 'schedule_hist.csv', icon: '📅', desc: 'Harmonogram pracy gniazd · RBH planned · zmiany' },
        ].map(({ key, label, icon, desc }) => (
          <div key={key} style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 22 }}>{icon}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{label}</div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5, flex: 1 }}>{desc}</div>
            <button
              type="button"
              style={{ ...s.btn(false), fontSize: 11, width: '100%', textAlign: 'center' }}
              onClick={() => dlCSV(SAMPLE_CSVS[key].content, SAMPLE_CSVS[key].filename)}>
              ↓ Pobierz przykład
            </button>
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
