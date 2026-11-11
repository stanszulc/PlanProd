// Wspólna logika terminów i OTIF dla zakładek Realizacja / Bufor / Spóźnione ZS.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parsuje datę/czas lokalnie. Data bez godziny = początek dnia (lokalnie). */
export function parseDt(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str) ? null : str;
  if (typeof str !== 'string') {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  const t = str.trim();
  if (!t) return null;
  if (DATE_ONLY.test(t)) {
    const [y, m, d] = t.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0);
  }
  const dt = new Date(t.includes('T') ? t : t.replace(' ', 'T'));
  return isNaN(dt) ? null : dt;
}

/** Termin: data bez godziny = lokalny KONIEC dnia (23:59:59); z godziną jak parseDt. */
export function parseDueDate(str) {
  if (typeof str === 'string' && DATE_ONLY.test(str.trim())) {
    const [y, m, d] = str.trim().split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59);
  }
  return parseDt(str);
}

/** YYYY-MM-DD wg czasu lokalnego (toISOString przesuwa do UTC). */
export function fmtIsoDate(dt) {
  if (!dt || isNaN(dt)) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtDt(dt) {
  const d = parseDt(dt);
  if (!d) return '—';
  return String(d.getMonth() + 1).padStart(2, '0') + '.' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

export function tocZone(toc) {
  if (!toc) return 'green';
  if (typeof toc === 'string') return toc;
  return toc.zone || 'green';
}

/**
 * OTIF pozycji (operacje jednego ZP).
 * - Pozycja w całości CNC: onTime/inFull/otif = null (pomijana w agregacjach).
 * - Ilość (In Full): wg OPERACJI KOŃCOWEJ routingu (ostatnia nie-CNC wg sequence),
 *   nie sumy po operacjach (suma mnoży sztuki przez liczbę operacji i pozwala
 *   nadprodukcji na wcześniejszej operacji maskować brak na końcowej).
 * - Ocena inFull tylko gdy wszystkie operacje nie-CNC są CNF.
 * - ZP w toku: inFull = null; onTime = false gdy now > termin (już spóźnione),
 *   w przeciwnym razie null; otif = false tylko gdy onTime === false, inaczej null.
 */
export function calcOtif(opsIn, now = new Date()) {
  const ops = opsIn.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const nonCnc = ops.filter(o => o.status !== 'CNC');
  const cnfOps = ops.filter(o => o.status === 'CNF');
  const allCnc = nonCnc.length === 0;
  const need_date = parseDueDate(ops[ops.length - 1]?.need_date || ops[0]?.need_date);

  if (allCnc) {
    return { allCnc, need_date, onTime: null, inFull: null, otif: null, volPlan: 0, volActual: 0 };
  }

  const finalOp = nonCnc[nonCnc.length - 1];
  const volPlan = finalOp.volume_plan || 0;
  const volActual = finalOp.volume_actual || 0;
  const finished = cnfOps.length === nonCnc.length;

  let onTime = null, inFull = null;
  if (finished) {
    inFull = volPlan > 0 && volActual >= volPlan;
    const actualEnd = parseDt(cnfOps[cnfOps.length - 1].actual_end);
    if (actualEnd && need_date) onTime = actualEnd <= need_date;
  } else if (need_date && now > need_date) {
    onTime = false;
  }

  const otif = onTime === true && inFull === true ? true
    : onTime === false || inFull === false ? false
    : null;
  return { allCnc, need_date, onTime, inFull, otif, volPlan, volActual };
}

/** OTIF ZS z pozycji: pomija anulowane (allCnc). */
export function aggregateZsOtif(positions) {
  const active = positions.filter(p => !p.allCnc);
  if (!active.length) return null;
  if (active.some(p => p.otif === false)) return false;
  return active.every(p => p.otif === true) ? true : null;
}
