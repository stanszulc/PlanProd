import { useState } from 'react';
import { T, s } from '../../constants/theme.js';
import { WC_DAILY_CAPACITY } from '../../constants/demoData.js';

const DAY_NAMES = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];

// Demo capacity brygad [rbh/dzień przy pełnej obsadzie 2 zmian]
const BRIGADE_DEMO = {
  'Maszyny':             202.6,
  'Kanały':              180.4,
  'Kratki Stalowe':      156.7,
  'Kratki Aluminium':    140.0,
  'Regulatory VAV/NSDZ': 124.6,
  'Przepustnice':         92.4,
  'Gniazdo KTM/KTS':      84.9,
  'Pilarnia Aluminium':   80.0,
  'Linia WKP':            73.4,
  'Pilarnia Stalowa':     72.0,
  'iSWAY':                48.0,
  'Spawalnia':            56.0,
  'Montaż Podzespołów':   60.1,
  'Linia KWP/KWP-L':      54.9,
  'Gniazdo montażu SN':   32.0,
  'Gniazdo NSDZ':         16.0,
  'Gniazdo ZS':           16.0,
  'Heager':                8.0,
  'Klinczarka':            8.0,
  'Szlifiernia Stal':      8.0,
};

// Domyślny grafik brygady: pon-pt = capacity, sob-nd = 0
function defaultBrigadeSchedule(capH) {
  return [capH, capH, capH, capH, capH, 0, 0];
}

// Inicjalizuj grafik brygad z demo danych
export function initBrigadeSchedule() {
  const sched = {};
  for (const [br, cap] of Object.entries(BRIGADE_DEMO)) {
    sched[br] = defaultBrigadeSchedule(cap);
  }
  return sched;
}

export function SettingsTab({ config, onConfigChange }) {
  const [localConfig, setLocalConfig] = useState(() => ({
    ...config,
    brigadeSchedule: config.brigadeSchedule || initBrigadeSchedule(),
  }));
  const [expandedBrigade, setExpandedBrigade] = useState(null);

  function update(key, value) {
    const next = { ...localConfig, [key]: value };
    setLocalConfig(next);
    onConfigChange(next);
  }

  function updateBrigadeDay(brigade, dayIdx, value) {
    const prev = localConfig.brigadeSchedule || {};
    const arr  = [...(prev[brigade] || defaultBrigadeSchedule(BRIGADE_DEMO[brigade] || 0))];
    arr[dayIdx] = Math.max(0, value);
    const next = { ...prev, [brigade]: arr };
    update('brigadeSchedule', next);
  }

  const SectionHeader = ({ icon, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
        textTransform: 'uppercase', color: T.text2 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: T.border, marginLeft: 4 }} />
    </div>
  );

  const Row = ({ label, desc, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );

  const NumInput = ({ value, onChange, min = 0, max = 30, unit = '' }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => onChange(Math.max(min, value - 1))}
        style={{ ...s.btn(false), width: 28, height: 28, padding: 0, fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
      <span style={{ fontSize: 15, fontWeight: 600, color: T.accent,
        minWidth: 28, textAlign: 'center' }}>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))}
        style={{ ...s.btn(false), width: 28, height: 28, padding: 0, fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      {unit && <span style={{ fontSize: 11, color: T.text3 }}>{unit}</span>}
    </div>
  );

  const brigadeSchedule = localConfig.brigadeSchedule || initBrigadeSchedule();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 760 }}>

      {/* ── PILNOŚĆ ── */}
      <section>
        <SectionHeader icon="⚡" label="Funkcja pilności" />
        <Row label="Bufor bezpieczeństwa VIP"
          desc="Klienci priorytetowi planowani jakby termin był wcześniejszy o X dni.">
          <NumInput value={localConfig.vipBufferDays}
            onChange={v => update('vipBufferDays', v)} min={0} max={14} unit="dni" />
        </Row>
        <Row label="Horyzont planowania"
          desc="Planuj tylko ZP z terminem do N dni od planStart.">
          <NumInput value={localConfig.horizonDays || 14}
            onChange={v => update('horizonDays', v)} min={1} max={90} unit="dni" />
        </Row>
        <Row label="Metoda sortowania ZP"
          desc="Kolejność w jakiej ZP wchodzi na maszyny.">
          <select value={localConfig.urgencyMethod}
            onChange={e => update('urgencyMethod', e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
            <option value="cr">Critical Ratio (zalecane)</option>
            <option value="due_date">Due date (najprostsze)</option>
            <option value="slack">Slack czasowy</option>
          </select>
        </Row>
      </section>

      {/* ── GRAFIK PRACY BRYGAD ── */}
      <section>
        <SectionHeader icon="👷" label="Grafik pracy brygad" />
        <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
          Dostępny czas pracy per brygada per dzień tygodnia [rbh/dzień].
          Kliknij brygadę aby edytować. Scheduler używa tych wartości jako capacity.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Nagłówek */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px repeat(7, 1fr) 80px',
            gap: 4, padding: '6px 8px', background: T.surface2, borderRadius: 6,
            fontSize: 10, fontWeight: 700, color: T.text3, textTransform: 'uppercase' }}>
            <div>Brygada</div>
            {DAY_NAMES.map(d => <div key={d} style={{ textAlign: 'center' }}>{d}</div>)}
            <div style={{ textAlign: 'center' }}>Suma/tydz</div>
          </div>

          {Object.entries(brigadeSchedule).map(([br, arr]) => {
            const isOpen  = expandedBrigade === br;
            const weekSum = arr.reduce((s, v) => s + v, 0);
            const demoRef = BRIGADE_DEMO[br] ?? 0;

            return (
              <div key={br} style={{ border: `1px solid ${T.border}`, borderRadius: 6,
                overflow: 'hidden' }}>

                {/* Wiersz brygady */}
                <div style={{ display: 'grid',
                  gridTemplateColumns: '200px repeat(7, 1fr) 80px',
                  gap: 4, padding: '6px 8px',
                  background: isOpen ? T.surface2 : T.surface,
                  cursor: 'pointer', alignItems: 'center' }}
                  onClick={() => setExpandedBrigade(isOpen ? null : br)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, color: T.text3,
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform .15s', display: 'inline-block' }}>▶</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{br}</span>
                  </div>
                  {arr.map((h, i) => (
                    <div key={i} style={{ textAlign: 'center', fontSize: 12,
                      fontWeight: 600, fontFamily: 'monospace',
                      color: i >= 5 ? T.text3 : h === 0 ? T.bn : T.ok }}>
                      {h > 0 ? h + 'h' : '–'}
                    </div>
                  ))}
                  <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700,
                    fontFamily: 'monospace', color: T.accent }}>
                    {weekSum}h
                  </div>
                </div>

                {/* Edycja — rozwinięta */}
                {isOpen && (
                  <div style={{ padding: '12px 16px', background: T.surface2,
                    borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
                      Ref. pełna obsada: <strong style={{ color: T.accent }}>{demoRef}h/dzień</strong>
                      &nbsp;·&nbsp; Zmień godziny per dzień tygodnia:
                    </div>
                    <div style={{ display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
                      {DAY_NAMES.map((day, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column',
                          alignItems: 'center', gap: 4 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: T.text3 }}>{day}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <button onClick={() => updateBrigadeDay(br, i, (arr[i] || 0) - 8)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${T.border2}`,
                                background: T.surface3, color: T.bn, cursor: 'pointer',
                                fontSize: 14, lineHeight: 1, display: 'flex',
                                alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <input
                              type="number" min="0" step="8"
                              value={arr[i] || 0}
                              onChange={e => updateBrigadeDay(br, i, parseFloat(e.target.value) || 0)}
                              style={{ width: 52, textAlign: 'center', fontSize: 13,
                                fontWeight: 600, fontFamily: 'monospace',
                                padding: '3px 4px', borderRadius: 4,
                                border: `1px solid ${T.border2}`,
                                background: T.surface, color: T.text }}
                            />
                            <button onClick={() => updateBrigadeDay(br, i, (arr[i] || 0) + 8)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${T.border2}`,
                                background: T.surface3, color: T.ok, cursor: 'pointer',
                                fontSize: 14, lineHeight: 1, display: 'flex',
                                alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                          <div style={{ fontSize: 9, color: T.text3 }}>
                            {i < 5 ? (arr[i] > 0 ? `${Math.round(arr[i]/8)} zm.` : 'wolne') : 'weekend'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => {
                        DAY_NAMES.forEach((_, i) => {
                          if (i < 5) updateBrigadeDay(br, i, demoRef);
                        });
                      }} style={{ ...s.btn(false), fontSize: 11 }}>
                        ↺ Przywróć domyślne ({demoRef}h)
                      </button>
                      <button onClick={() => {
                        DAY_NAMES.forEach((_, i) => updateBrigadeDay(br, i, 0));
                      }} style={{ ...s.btn(false), fontSize: 11, color: T.bn }}>
                        Wyzeruj
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── GRAFIK DOMYŚLNY MASZYN ── */}
      <section>
        <SectionHeader icon="📅" label="Domyślny grafik maszyn (fallback)" />
        <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
          Stosowany gdy maszyna nie ma grafiku w pliku CSV.
        </p>
        {DAY_NAMES.map((day, i) => (
          <Row key={day} label={day} desc={i < 5 ? 'Dzień roboczy' : 'Weekend'}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[0, 8, 16, 24].map(h => (
                <button key={h}
                  onClick={() => {
                    const next = [...localConfig.defaultSchedule];
                    next[i] = h;
                    update('defaultSchedule', next);
                  }}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6,
                    border: `1px solid ${localConfig.defaultSchedule[i] === h ? T.accent : T.border2}`,
                    background: localConfig.defaultSchedule[i] === h ? T.accentBg : T.surface2,
                    color: localConfig.defaultSchedule[i] === h ? T.accent : T.text2,
                    cursor: 'pointer',
                    fontWeight: localConfig.defaultSchedule[i] === h ? 600 : 400 }}>
                  {h}h
                </button>
              ))}
            </div>
          </Row>
        ))}
      </section>

      {/* ── PLANSTART ── */}
      <section>
        <SectionHeader icon="📍" label="Plan Start" />
        <Row label="Automatyczny planStart"
          desc="Gdy włączony, planStart = dzisiaj przy każdym imporcie danych.">
          <div onClick={() => update('autoPlanStart', !localConfig.autoPlanStart)}
            style={{ width: 48, height: 26, borderRadius: 13, cursor: 'pointer',
              background: localConfig.autoPlanStart ? T.accent : T.surface3,
              border: `1px solid ${localConfig.autoPlanStart ? T.accent : T.border2}`,
              position: 'relative', transition: 'all 0.2s' }}>
            <div style={{ position: 'absolute', top: 3,
              left: localConfig.autoPlanStart ? 24 : 3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </Row>
      </section>

      <div style={{ fontSize: 11, color: T.text3, padding: '10px 14px',
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
        Zmiany są stosowane natychmiast. Ustawienia przechowywane lokalnie w tej sesji.
      </div>
    </div>
  );
}