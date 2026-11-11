import { useState, useMemo } from 'react';
import { T, s } from '../../constants/theme.js';

const DAY_NAMES = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];

function SectionHeader({ icon, label }) {
  return (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
    <span style={{ fontSize: 16 }}>{icon}</span>
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: T.text2 }}>{label}</span>
    <div style={{ flex: 1, height: 1, background: T.border, marginLeft: 4 }} />
  </div>
  );
}

function Row({ label, desc, children }) {
  return (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, padding: '12px 0', borderBottom: `1px solid ${T.border}` }}>
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{label}</div>
      {desc && <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{desc}</div>}
    </div>
    {children}
  </div>
  );
}

function NumInput({ value, onChange, min = 0, max = 30, unit = '' }) {
  return (
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
}

export function SettingsTab({ config, onConfigChange, wcCapacity = {}, onWcCapacityChange, wcToBrygada = {} }) {
  const [localConfig, setLocalConfig] = useState(() => ({ ...config }));
  const [expandedBrigade, setExpandedBrigade] = useState(null);

  function update(key, value) {
    const next = { ...localConfig, [key]: value };
    setLocalConfig(next);
    onConfigChange(next);
  }

  const brigadeToWc = useMemo(() => {
    const map = {};
    Object.entries(wcToBrygada).forEach(([wc, brygada]) => {
      if (!map[brygada]) map[brygada] = [];
      if (!map[brygada].includes(wc)) map[brygada].push(wc);
    });
    return map;
  }, [wcToBrygada]);

  function getBrigadeCapH(brygada) {
    const wcs = brigadeToWc[brygada] || [];
    if (!wcs.length) return 0;
    return wcs.reduce((s, wc) => s + (wcCapacity[wc] ?? 8), 0);
  }

  function updateWcCapacity(wc, value) {
    if (!onWcCapacityChange) return;
    onWcCapacityChange(prev => ({ ...prev, [wc]: Math.max(0, value) }));
  }

  const brigades = Object.keys(brigadeToWc).sort();

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
        <Row label="Bufor bezpieczeństwa (wszystkie ZP)"
          desc="ALAP: planuj jakby termin był wcześniejszy o X dni. Zabezpiecza przed przekroczeniem terminu.">
          <NumInput value={localConfig.safetyBufferDays ?? 1}
            onChange={v => update('safetyBufferDays', v)} min={0} max={14} unit="dni" />
        </Row>
        <Row label="Horyzont planowania"
          desc="Planuj tylko ZP z terminem do N dni od planStart.">
          <NumInput value={localConfig.horizonDays || 14}
            onChange={v => update('horizonDays', v)} min={1} max={90} unit="dni" />
        </Row>
        <Row label="Godzina startu zmiany"
          desc="Od której godziny maszyny zaczynają pracę (np. 6 = 06:00). Wpływa na timestampy segmentów na Gancie.">
          <NumInput value={localConfig.shiftStart ?? 6}
            onChange={v => update('shiftStart', v)} min={0} max={12} unit="h" />
        </Row>
        <Row label="Czas logistyki między operacjami"
          desc="Minimalny odstęp doliczany do startu kolejnej operacji, gdy zmienia się gniazdo/maszyna (transport). Próg minimalny, nie bezwarunkowy dodatek — jeśli maszyna docelowa jest zajęta dłużej niż ten czas, nie sumuje się z oczekiwaniem.">
          <NumInput value={localConfig.transferTimeH ?? 2}
            onChange={v => update('transferTimeH', v)} min={0} max={24} unit="h" />
        </Row>
        <Row label="Metoda sortowania ZP"
          desc="Kolejność w jakiej ZP wchodzi na maszyny.">
          <select value={localConfig.urgencyMethod}
            onChange={e => update('urgencyMethod', e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
            <option value="atc">ATC — Apparent Tardiness Cost (zalecane)</option>
            <option value="cr">Critical Ratio</option>
            <option value="due_date">Due date (najprostsze)</option>
            <option value="slack">Slack czasowy</option>
          </select>
        </Row>
        <Row label="Priorytet maszyny w brygadzie mieszanej"
          desc="Domyślna przewaga maszyny (2xxxx) nad gniazdami (3xxxx) tej samej brygady przy konkurencji o wspólną pulę godzin — przełamywalna pilniejszym (VIP/bliski termin) ZP na gnieździe.">
          <NumInput value={localConfig.machineBiasH ?? 8}
            onChange={v => update('machineBiasH', v)} min={0} max={24} unit="h" />
        </Row>
      </section>

      {/* ── OPERACJE RÓWNOLEGŁE ── */}
      <section>
        <SectionHeader icon="🔀" label="Operacje równoległe" />
        <Row label="Tryb harmonogramowania operacji"
          desc="Graph: operacje na maszynach z listy 'maszyny równoległe' (zakładka Import) startują niezależnie od siebie — kolejna operacja czeka aż wszystkie się zakończą. Legacy: wszystkie operacje w ścisłym łańcuchu, jak dotychczas.">
          <select value={localConfig.schedulingGraphMode ?? 'graph'}
            onChange={e => update('schedulingGraphMode', e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${T.border2}`, background: T.surface2, color: T.text }}>
            <option value="graph">Graph — równoległe maszyny startowe (zalecane)</option>
            <option value="legacy">Legacy — ścisły łańcuch (jak dotychczas)</option>
          </select>
        </Row>
      </section>

      {/* ── CAPACITY MASZYN ── */}
      <section>
        <SectionHeader icon="⚙️" label="Capacity maszyn / stanowisk [rbh/dzień]" />
        <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
          Domyślna dostępność per maszyna/stanowisko w dni robocze.
          Zmiana dotyczy nowych importów — nie nadpisuje ręcznych edycji w Heatmapie.
          Maszyny (2xxxx): max 24h. Stanowiska (3xxxx): liczba_pracowników × zmiany × 8h.
        </p>
        {!brigades.length && (
          <div style={{ fontSize: 12, color: T.text3, padding: '12px 0' }}>
            Brak danych — załaduj plik ERP aby zobaczyć maszyny.
          </div>
        )}
        {brigades.map(brygada => {
          const wcs      = brigadeToWc[brygada] || [];
          const capTotal = getBrigadeCapH(brygada);
          const isOpen   = expandedBrigade === brygada;
          return (
            <div key={brygada} style={{ border: `1px solid ${T.border}`, borderRadius: 6,
              overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', background: isOpen ? T.surface2 : T.surface,
                cursor: 'pointer' }}
                onClick={() => setExpandedBrigade(isOpen ? null : brygada)}>
                <span style={{ fontSize: 9, color: T.text3, display: 'inline-block',
                  transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{brygada}</span>
                <span style={{ fontSize: 11, color: T.text3 }}>{wcs.length} maszyn/stanowisk</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.accent,
                  fontFamily: 'monospace', minWidth: 60, textAlign: 'right' }}>
                  Σ {Math.round(capTotal * 10) / 10}h/d
                </span>
              </div>
              {isOpen && (
                <div style={{ padding: '10px 16px', background: T.surface2,
                  borderTop: `1px solid ${T.border}`, display: 'flex',
                  flexDirection: 'column', gap: 8 }}>
                  {wcs.sort().map(wc => {
                    const cap     = wcCapacity[wc] ?? 8;
                    const isMach  = String(wc).startsWith('2');
                    const maxCap  = isMach ? 24 : 240;
                    return (
                      <div key={wc} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11,
                          color: T.text3, minWidth: 52 }}>{wc}</span>
                        <span style={{ fontSize: 11, color: T.text2, flex: 1 }}>
                          {isMach ? '🔧 maszyna' : '👷 stanowisko'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {[8, 16, 24].map(h => (
                            <button key={h} onClick={() => updateWcCapacity(wc, h)}
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5,
                                border: `1px solid ${cap === h ? T.accent : T.border2}`,
                                background: cap === h ? T.accentBg : T.surface3,
                                color: cap === h ? T.accent : T.text3, cursor: 'pointer' }}>
                              {h}h
                            </button>
                          ))}
                          {!isMach && [32, 48].map(h => (
                            <button key={h} onClick={() => updateWcCapacity(wc, h)}
                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5,
                                border: `1px solid ${cap === h ? T.accent : T.border2}`,
                                background: cap === h ? T.accentBg : T.surface3,
                                color: cap === h ? T.accent : T.text3, cursor: 'pointer' }}>
                              {h}h
                            </button>
                          ))}
                          <input type="number" min={0} max={maxCap} step={8} value={cap}
                            onChange={e => updateWcCapacity(wc, parseFloat(e.target.value) || 0)}
                            style={{ width: 52, textAlign: 'center', fontSize: 12,
                              fontWeight: 600, fontFamily: 'monospace', padding: '2px 4px',
                              borderRadius: 4, border: `1px solid ${T.border2}`,
                              background: T.surface, color: T.text }} />
                          <span style={{ fontSize: 10, color: T.text3 }}>h/d</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── GRAFIK DOMYŚLNY ── */}
      <section>
        <SectionHeader icon="📅" label="Domyślny grafik maszyn (fallback)" />
        <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
          Stosowany gdy maszyna nie ma grafiku w harmonogramie.
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
        Zmiany capacity są stosowane przy następnym imporcie ERP. Ustawienia przechowywane w tej sesji.
      </div>
    </div>
  );
}