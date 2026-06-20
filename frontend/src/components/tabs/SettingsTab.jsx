import { useState } from 'react';
import { T, s } from '../../constants/theme.js';

export function SettingsTab({ config, onConfigChange }) {
  const [localConfig, setLocalConfig] = useState(config);

  function update(key, value) {
    const next = { ...localConfig, [key]: value };
    setLocalConfig(next);
    onConfigChange(next);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 640 }}>

      {/* ── PILNOŚĆ ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="⚡" label="Funkcja pilności" />

        <Row
          label="Bufor bezpieczeństwa VIP"
          desc="Klienci priorytetowi (priority=1) planowani jakby termin był wcześniejszy o X dni. Zapobiega spóźnieniom VIP przy pełnych maszynach.">
          <NumInput
            value={localConfig.vipBufferDays}
            onChange={v => update('vipBufferDays', v)}
            min={0} max={14} unit="dni" />
        </Row>

        <Row
          label="Horyzont planowania"
          desc="Planuj tylko ZP z terminem do N dni od planStart. Spóźnione zawsze wchodzą. Redukuje czas obliczeń.">
          <NumInput
            value={localConfig.horizonDays || 14}
            onChange={v => update('horizonDays', v)}
            min={1} max={90} unit="dni" />
        </Row>

        <Row
          label="Metoda sortowania ZP"
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

      {/* ── GRAFIK DOMYŚLNY ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📅" label="Domyślny grafik maszyn" />
        <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
          Stosowany gdy maszyna nie ma grafiku w pliku CSV. Zmiana przelicza harmonogram.
        </p>

        {['Pon','Wt','Śr','Czw','Pt','Sob','Nd'].map((day, i) => (
          <Row key={day} label={day}
            desc={i < 5 ? 'Dzień roboczy' : 'Weekend'}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[0, 8, 16, 24].map(h => (
                <button key={h}
                  onClick={() => {
                    const next = [...localConfig.defaultSchedule];
                    next[i] = h;
                    update('defaultSchedule', next);
                  }}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 6,
                    border: `1px solid ${localConfig.defaultSchedule[i] === h ? T.accent : T.border2}`,
                    background: localConfig.defaultSchedule[i] === h ? T.accentBg : T.surface2,
                    color: localConfig.defaultSchedule[i] === h ? T.accent : T.text2,
                    cursor: 'pointer', fontWeight: localConfig.defaultSchedule[i] === h ? 600 : 400,
                  }}>
                  {h}h
                </button>
              ))}
            </div>
          </Row>
        ))}
      </section>

      {/* ── PLANSTART ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader icon="📍" label="Horyzont planowania" />
        <Row
          label="Automatyczny planStart"
          desc="Gdy włączony, planStart = dzisiaj przy każdym imporcie danych.">
          <div
            onClick={() => update('autoPlanStart', !localConfig.autoPlanStart)}
            style={{
              width: 48, height: 26, borderRadius: 13, cursor: 'pointer',
              background: localConfig.autoPlanStart ? T.accent : T.surface3,
              border: `1px solid ${localConfig.autoPlanStart ? T.accent : T.border2}`,
              position: 'relative', transition: 'all 0.2s',
            }}>
            <div style={{
              position: 'absolute', top: 3,
              left: localConfig.autoPlanStart ? 24 : 3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
        </Row>
      </section>

      {/* Info */}
      <div style={{ fontSize: 11, color: T.text3, padding: '10px 14px',
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
        Zmiany są stosowane natychmiast i powodują przeliczenie harmonogramu.
        Ustawienia są przechowywane lokalnie w tej sesji.
      </div>
    </div>
  );
}