# ── CP-SAT: WEIGHTED TARDINESS ───────────────────────────────────────────────
#
# Kluczowe różnice vs solve() (stara funkcja):
#
#  STARA (solve):
#    - terminy jako twarde ograniczenia Add(end <= due_s)  → INFEASIBLE gdy
#      łączna praca > dostępny czas gniazda
#    - brak wag per ZP
#    - model.minimize(sum(tard_vars))  ← suma równoważna, VIP = tak samo jak reszta
#
#  NOWA (solve_tardiness):
#    - terminy jako MIĘKKIE — tardiness_zp = max(0, end - due_s)  bez Add twardego
#    - wagi: VIP = waga x5, reszta = waga x1  → CP-SAT priorytetyzuje VIP
#    - pre-check obciążenia gniazd — jeśli gniazdo > 100% capacity, loguje ostrzeżenie
#      zamiast zwracać INFEASIBLE
#    - większy horyzont — nie obcinamy do 120d, liczymy od max(due_date) + bufor
#    - zwraca szczegółowy raport: lateCount, totalDelay, maxDelay, wcUtilization
#
# Etap 4 audytu — zgodność z silnikiem frontendowym (scheduler.worker.js):
#
#  OKNA DOSTĘPNOŚCI (OŚ PRACY). Każdy zasób (maszyna 2xxxx albo pula brygady 3xxxx)
#  ma własną "oś pracy": ciąg slotów 15-min, które realnie istnieją w kalendarzu
#  (okna dni, bez weekendów / dni z avail=0 / godzin poza zmianą). Zmienne startu
#  operacji żyją na tej osi (ws), a czas kalendarzowy to element(tablica osi, ws).
#  Dzięki temu operacja dłuższa niż okno dnia jest dzielona jak w findSlotForward
#  (np. 20 h na maszynie 16 h/dobę = 16 h + 4 h następnego dnia roboczego), a
#  NoOverlap/Cumulative liczone na osi pracy nie widzą przerw.
#  Okno dnia (jak findSlotForward): długość min(dostępność, 24 h), start = shiftStart
#  (cfg.shiftStart, domyślnie 6); gdy shiftStart + okno > 24 h okno przesuwa się
#  wcześniej (24 h → 00:00-24:00).
#
#  POOL 3xxxx (KOMPROMIS). Frontend: gniazda 3xxxx jednej brygady współdzielą
#  dzienny BUDŻET GODZIN (suma dostępności gniazd), bez limitu jednym operatorem.
#  Dokładne "suma godzin zadań na dzień <= budżet" wymagałoby zmiennych
#  godzinowych per (operacja x dzień) — zbyt ciężkie dla CP-SAT. Zamiast tego pula
#  = cumulative z K "osobami" (demand 1), K = ceil(budżet_dzienny / okno_dnia);
#  w dniach o mniejszym budżecie pojemność jest obniżana stałymi przedziałami.
#  Okno puli = min(max dostępność gniazda, 24 h). Gdy budżet jest wielokrotnością
#  okna (typowo: n gniazd x 16 h) model jest dokładny; w przeciwnym razie K jest
#  zaokrąglane w górę (lekkie zawyżenie przepustowości). Zadanie puli nie jest
#  dzielone między "osoby", tylko ciągłe na osi pracy puli. Brygady mieszane
#  (maszyna 2xxxx czerpiąca godziny z puli) NIE są modelowane — maszyna ma własną
#  oś. Mapowanie gniazdo→brygada: cfg['wcToBrygada'] (opcjonalne; bez niego każde
#  gniazdo 3xxxx jest osobną pulą).
#
#  PREDECESSORS / TRANSFER. Gdy któraś operacja ZP ma niepuste `predecessors`,
#  precedencje wg grafu (klucz operacji = _opUid ?? sequence; start >= koniec
#  każdego poprzednika + transfer). Duplikat klucza / brakujący poprzednik / cykl →
#  fallback do łańcucha po `sequence` + wpis w `warnings`. Bez predecessors łańcuch
#  po `sequence`. Transfer (cfg.transferTimeH, domyślnie 2 h) dolicza się, gdy
#  gniazdo następnika jest inne niż poprzednika (jak TRANSFER_TIME_H we frontendzie).
#
#  CEL: leksykograficznie (1) ważone spóźnienie, (2) suma czasów zakończenia ZP
#  (zwarty harmonogram zamiast dowolnego przesuwania w obrębie luzu).
# ─────────────────────────────────────────────────────────────────────────────

import math, sys
from bisect import bisect_left
from datetime import datetime, timedelta
from ortools.sat.python import cp_model

SLOT_MIN  = 15
S_PER_DAY = 24 * 60 // SLOT_MIN   # 96 slotów/dobę
SLOTS_H   = 60 // SLOT_MIN        # 4 sloty/godz.
DEFAULT_H = 16                    # = WORK_DAY_H z frontendu
MACHINE_CEILING_H = 24
MAX_JOBS  = 8000                    # limit CP-SAT — powyżej czas eksploduje


def _date_str(dt):
    return dt.strftime('%Y-%m-%d')


def _get_avail(wc, ds, wc_sched):
    """Dostępność gniazda w dniu ds [h] — jak getAvail w scheduler.js:
    brak harmonogramu lub brak klucza daty w słowniku → weekend 0, dzień roboczy DEFAULT_H."""
    sc = wc_sched.get(str(wc))
    dt = datetime.strptime(ds, '%Y-%m-%d')
    weekend = dt.weekday() >= 5
    if sc is None:
        return 0.0 if weekend else DEFAULT_H
    if isinstance(sc, dict):
        v = sc.get(ds)
        if v is None:
            return 0.0 if weekend else DEFAULT_H
        return float(v)
    if isinstance(sc, list):
        idx = dt.weekday()
        return float(sc[idx]) if idx < len(sc) and sc[idx] is not None else 0.0
    return DEFAULT_H


def _h2s(h):
    """Godziny → sloty 15-minutowe (zaokrąglenie w górę, min 1)."""
    if h <= 0:
        return 0
    return max(1, math.ceil(h * 60 / SLOT_MIN))


def _slot_to_dt(slot, plan_start):
    return plan_start + timedelta(
        days=slot // S_PER_DAY,
        minutes=(slot % S_PER_DAY) * SLOT_MIN
    )


def _day_window(avail_h, shift_h):
    """Okno dnia (start_slot_w_dobie, długość_slotów) wg findSlotForward lub None."""
    if avail_h <= 0:
        return None
    win   = min(avail_h, MACHINE_CEILING_H)
    floor = shift_h if shift_h + win <= 24 else max(0.0, 24 - win)
    st = int(round(floor * SLOTS_H))
    ln = int(round(win * SLOTS_H))
    ln = min(ln, S_PER_DAY - st)
    return (st, ln) if ln > 0 else None


def _build_axis(members, horizon, plan_start, wc_sched, shift_h, pool):
    """
    Oś pracy zasobu (maszyny lub puli brygady).
    members — kody gniazd składających zasób; pool — True dla puli 3xxxx.
    Zwraca dict: cal (slot kalendarzowy dla indeksu pracy), days
    [(cal_start, off, len)], K (liczba równoległych "osób"), fillers
    [(off, len, demand)] — stałe obniżenia pojemności w dniach o mniejszym budżecie.
    """
    cal, days, day_k = [], [], []
    for d in range(horizon):
        ds     = _date_str(plan_start + timedelta(days=d))
        avails = [_get_avail(w, ds, wc_sched) for w in members]
        win    = _day_window(max(avails), shift_h)
        if win is None:
            continue
        st, ln = win
        off = len(cal)
        base = d * S_PER_DAY + st
        cal.extend(range(base, base + ln))
        days.append((base, off, ln))
        if pool:
            budget = int(round(sum(avails) * SLOTS_H))
            day_k.append(max(1, math.ceil(budget / ln)))
        else:
            day_k.append(1)
    K = max(day_k) if day_k else 1
    fillers = [(off, ln, K - k) for (base, off, ln), k in zip(days, day_k) if k < K]
    return {
        'cal': cal, 'days': days, 'K': K, 'fillers': fillers,
        'offs': [off for _, off, _ in days],
        'lens': [ln for _, _, ln in days],
        'gaps': [base - off for base, off, _ in days],   # slot kalendarza = indeks pracy + gap(dnia)
    }


def _work_to_cal(model, axis, w, tag):
    """
    Zmienna: slot kalendarzowy odpowiadający indeksowi pracy w (wyrażenie liniowe).
    Zamiast jednego elementu na tablicy całej osi (tysiące wpisów — presolve CP-SAT
    eksploduje) używamy zmiennej DNIA i trzech małych elementów (offset, długość
    okna, przesunięcie kalendarza) o rozmiarze = liczba dni roboczych.
    """
    nd  = len(axis['offs'])
    day = model.new_int_var(0, nd - 1, f'd_{tag}')
    off = model.new_int_var(min(axis['offs']), max(axis['offs']), f'o_{tag}')
    gap = model.new_int_var(min(axis['gaps']), max(axis['gaps']), f'g_{tag}')
    model.add_element(day, axis['offs'], off)
    model.add_element(day, axis['gaps'], gap)
    model.add(w >= off)
    if len(set(axis['lens'])) == 1:
        model.add(w <= off + (axis['lens'][0] - 1))
    else:
        ln = model.new_int_var(min(axis['lens']), max(axis['lens']), f'n_{tag}')
        model.add_element(day, axis['lens'], ln)
        model.add(w <= off + ln - 1)
    cal = model.new_int_var(0, nd and (axis['cal'][-1]), f'c_{tag}')
    model.add(cal == w + gap)
    return cal


def _build_wc_avail(wc_sched, wc_set, horizon, plan_start):
    """wc → suma slotów dostępnych w horyzoncie (dla pre-checku)."""
    out = {}
    for wc in wc_set:
        total = 0
        for d in range(horizon):
            ds = _date_str(plan_start + timedelta(days=d))
            total += _h2s(_get_avail(wc, ds, wc_sched))
        out[wc] = total
    return out


def _precheck_load(zp_list, routing, wc_avail_slots):
    """
    Pre-check: czy suma pracy per gniazdo <= dostępna capacity?
    Loguje ostrzeżenia — NIE blokuje uruchomienia solvera.
    Zwraca dict wc → utilization (0..∞, 1.0 = 100%).
    """
    wc_load = {}
    for zp in zp_list:
        for op in routing.get(zp.get('product', ''), []):
            wc  = str(op['workcenter'])
            vol = zp.get('volume', 1)
            ct  = op.get('ct_min', 0)
            dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
            dur_s = _h2s(dur_h)
            wc_load[wc] = wc_load.get(wc, 0) + dur_s

    util = {}
    for wc, load in wc_load.items():
        avail = wc_avail_slots.get(wc, 1)
        u = load / avail if avail > 0 else float('inf')
        util[wc] = round(u, 3)
        if u > 1.0:
            print(
                f"[PRECHECK] Gniazdo {wc}: obciążenie {u*100:.0f}% "
                f"(load={load}s, avail={avail}s) — spóźnienia nieuniknione",
                file=sys.stderr
            )
    return util


def _op_key(op):
    k = op.get('_opUid')
    return k if k is not None else op.get('sequence')


def _resolve_preds(zp_id, ops, warnings):
    """
    Lista poprzedników (indeksy w `ops`, posortowanych po sequence) per operacja.
    Graf z `predecessors` gdy jest poprawny; w przeciwnym razie łańcuch po sequence
    (+ ostrzeżenie, gdy to błąd danych).
    """
    n     = len(ops)
    chain = [[i - 1] if i > 0 else [] for i in range(n)]
    if not any(o.get('predecessors') for o in ops):
        return chain

    keys = [_op_key(o) for o in ops]
    if len(set(keys)) < n:
        warnings.append(f"ZP {zp_id}: duplikat numeru operacji w routingu — użyto łańcucha po sequence")
        return chain
    idx = {k: i for i, k in enumerate(keys)}
    preds = []
    for o in ops:
        pl = []
        for p in (o.get('predecessors') or []):
            if p not in idx:
                warnings.append(f"ZP {zp_id}: brak poprzednika {p} w routingu — użyto łańcucha po sequence")
                return chain
            pl.append(idx[p])
        preds.append(pl)

    # wykrywanie cyklu (Kahn)
    indeg = [len(p) for p in preds]
    succ  = [[] for _ in range(n)]
    for i, pl in enumerate(preds):
        for p in pl:
            succ[p].append(i)
    stack, seen = [i for i in range(n) if indeg[i] == 0], 0
    while stack:
        u = stack.pop()
        seen += 1
        for v in succ[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                stack.append(v)
    if seen < n:
        warnings.append(f"ZP {zp_id}: cykl w predecessors — użyto łańcucha po sequence")
        return chain
    return preds


def _topo_order(preds):
    """Kolejność topologiczna indeksów operacji (preds jest acykliczne)."""
    n = len(preds)
    indeg = [len(p) for p in preds]
    succ = [[] for _ in range(n)]
    for i, pl in enumerate(preds):
        for p in pl:
            succ[p].append(i)
    order, ready = [], [i for i in range(n) if indeg[i] == 0]
    while ready:
        u = ready.pop(0)
        order.append(u)
        for v in succ[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                ready.append(v)
    return order


def _segments_from_axis(axis, cs, ce):
    """Segmenty (start_slot, end_slot) pracy w oknach dni dla przedziału kalendarzowego [cs, ce)."""
    segs = []
    for base, off, ln in axis['days']:
        a, b = max(cs, base), min(ce, base + ln)
        if b > a:
            segs.append((a, b))
        elif base >= ce:
            break
    return segs or [(cs, ce)]


def solve_tardiness(zp_list, routing, wc_sched, plan_start, cfg):
    """
    CP-SAT z ważonym kosztem spóźnienia jako funkcją celu.

    Parametry cfg:
      horizonDays           — bazowy horyzont (domyślnie 14, rozszerzany do max due_date+30)
      vipBufferDays         — bufor dla VIP (domyślnie 2)
      cpSatTimeLimitSeconds — timeout solvera (domyślnie 60)
      cpSatDebug            — True = log_search_progress (domyślnie False)
      cpSatMaxJobs          — limit ZP (domyślnie 800)
      vipWeight             — waga tardiness dla VIP (domyślnie 5)
      normalWeight          — waga tardiness dla normalnych (domyślnie 1)
      shiftStart            — początek zmiany [h] (domyślnie 6)
      transferTimeH         — transfer między różnymi gniazdami [h] (domyślnie 2)
      wcToBrygada           — opcjonalne {gniazdo: brygada}; gniazda 3xxxx jednej
                              brygady tworzą wspólną pulę godzin

    Zwraca: (result_dict, status_name, elapsed_s)
      result_dict = { fwdZP, zpStatus, cpStatus, wcUtilization, warnings }
      lub None jeśli INFEASIBLE/UNKNOWN
    """
    vip_buf    = cfg.get('vipBufferDays', 2)
    time_limit = cfg.get('cpSatTimeLimitSeconds', 60)
    debug      = cfg.get('cpSatDebug', False)
    max_jobs   = cfg.get('cpSatMaxJobs', MAX_JOBS)
    w_vip      = cfg.get('vipWeight', 5)
    w_normal   = cfg.get('normalWeight', 1)
    shift_h    = float(cfg.get('shiftStart', 6) if cfg.get('shiftStart') is not None else 6)
    transfer_s = _h2s(cfg.get('transferTimeH', 2) if cfg.get('transferTimeH') is not None else 2)
    wc_to_bryg = {str(k): v for k, v in (cfg.get('wcToBrygada') or {}).items()}
    warnings   = []

    # ── 1. Horyzont — rozszerz do max(due_date) + 30d ────────────────────────
    base_horizon = cfg.get('horizonDays', 14) + 60
    max_due_str  = max((z.get('due_date', '') for z in zp_list), default='')
    if max_due_str:
        try:
            max_due_dt   = datetime.strptime(max_due_str, '%Y-%m-%d')
            needed       = (max_due_dt - plan_start).days + 30
            base_horizon = min(max(base_horizon, needed), 365)
        except Exception:
            pass
    horizon     = base_horizon
    total_slots = horizon * S_PER_DAY
    print(f"[TARDINESS] ZP={len(zp_list)}, horyzont={horizon}d, total_slots={total_slots}", file=sys.stderr)

    # ── 2. Zbierz WC ─────────────────────────────────────────────────────────
    wc_set = set()
    for zp in zp_list:
        for op in routing.get(zp.get('product', ''), []):
            wc_set.add(str(op['workcenter']))

    wc_avail_slots = _build_wc_avail(wc_sched, wc_set, horizon, plan_start)

    # ── 3. Pre-check obciążenia ───────────────────────────────────────────────
    wc_util = _precheck_load(zp_list, routing, wc_avail_slots)

    # ── 4. Filtr i sort ZP ───────────────────────────────────────────────────
    # Ogranicz do max_jobs — VIP najpierw, potem najwcześniejsze terminy
    zp_sorted = sorted(
        zp_list,
        key=lambda z: (0 if z.get('priority', 0) == 1 else 1, z.get('due_date', ''))
    )
    if len(zp_sorted) > max_jobs:
        print(f"[TARDINESS] Ograniczono do {max_jobs} ZP (było {len(zp_sorted)})", file=sys.stderr)
        zp_sorted = zp_sorted[:max_jobs]

    # ── 5. Osie pracy zasobów ────────────────────────────────────────────────
    # res_key: maszyna → kod gniazda, gniazdo 3xxxx → POOL_<brygada> (lub kod gniazda)
    def res_key(wc):
        if wc.startswith('3') and wc in wc_to_bryg:
            return f'POOL_{wc_to_bryg[wc]}'
        return wc

    axes = {}
    for wc in wc_set:
        key = res_key(wc)
        if key in axes:
            continue
        if wc.startswith('3'):
            if key != wc:
                br = wc_to_bryg[wc]
                members = sorted({w for w, b in wc_to_bryg.items() if b == br and w.startswith('3')} | {wc})
            else:
                members = [wc]
            axes[key] = _build_axis(members, horizon, plan_start, wc_sched, shift_h, True)
        else:
            axes[key] = _build_axis([wc], horizon, plan_start, wc_sched, shift_h, False)

    # ── 6. Buduj model CP-SAT ─────────────────────────────────────────────────
    model = cp_model.CpModel()

    res_intervals = {k: [] for k in axes}      # przedziały na osi pracy
    zp_tasks   = []   # (zp, [(op, cs, ce, dur_s, dur_h, axis_key|None)], due_s, weight)
    tard_terms = []   # (tard_var, weight)
    end_vars   = []   # zakończenia ZP (cel drugorzędny)
    n_ops_total = 0
    free_at     = {}   # zasób → pierwsze wolne indeksy osi pracy (dla wskazówki)

    for zp in zp_sorted:
        zp_id  = zp['zp_id']
        vol    = zp.get('volume', 1)
        is_vip = zp.get('priority', 0) == 1
        weight = w_vip if is_vip else w_normal

        # Due date → sloty (miękkie — tylko do obliczenia tardiness)
        try:
            due_dt = datetime.strptime(zp['due_date'], '%Y-%m-%d')
            buf    = vip_buf if is_vip else 0
            due_s  = max(0, (due_dt - plan_start).days - buf) * S_PER_DAY + S_PER_DAY - 1
        except Exception:
            due_s = total_slots

        ops = sorted(
            routing.get(zp.get('product', ''), []),
            key=lambda o: o.get('sequence', 999)
        )
        preds = _resolve_preds(zp_id, ops, warnings)

        nodes    = {}   # i → (cs, ce, wc) per operacja (także zerowe — przepuszczają graf)
        hint_ce  = {}   # i → szacowany koniec z zachłannego harmonogramu (wskazówka startowa)
        task_ops = []

        for i in _topo_order(preds):
            op = ops[i]
            wc    = str(op['workcenter'])
            ct    = op.get('ct_min', 0)
            dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
            dur_s = _h2s(dur_h)
            tag   = f'{zp_id}_{i}'

            if dur_s == 0 or wc not in wc_set:
                # węzeł zerowy: bez zasobu, tylko przepuszcza precedencje
                cs = model.new_int_var(0, total_slots, f'z_{tag}')
                nodes[i] = (cs, cs, wc)
                hint_ce[i] = max((hint_ce[p] for p in preds[i]), default=0)
            else:
                key  = res_key(wc)
                axis = axes[key]
                W    = len(axis['cal'])
                if W < dur_s:
                    # brak wystarczającej pracy w horyzoncie / gniazdo bez dostępności:
                    # operacja bez okien i bez zasobu (z ostrzeżeniem)
                    warnings.append(
                        f"ZP {zp_id}: gniazdo {wc} nie ma dość dostępnego czasu w horyzoncie "
                        f"— operacja zaplanowana bez okien dostępności"
                    )
                    cs = model.new_int_var(0, total_slots, f's_{tag}')
                    ce = model.new_int_var(0, total_slots + dur_s, f'e_{tag}')
                    model.add(ce == cs + dur_s)
                    nodes[i] = (cs, ce, wc)
                    hint_ce[i] = max((hint_ce[p] for p in preds[i]), default=0) + dur_s
                    task_ops.append((op, cs, ce, dur_s, dur_h, None))
                else:
                    ws  = model.new_int_var(0, W - dur_s, f'w_{tag}')
                    wl  = model.new_int_var(dur_s - 1, W - 1, f'wl_{tag}')
                    model.add(wl == ws + (dur_s - 1))
                    cs   = _work_to_cal(model, axis, ws, f's_{tag}')
                    last = _work_to_cal(model, axis, wl, f'l_{tag}')
                    ce   = model.new_int_var(1, total_slots + 1, f'e_{tag}')
                    model.add(ce == last + 1)
                    res_intervals[key].append(
                        model.new_fixed_size_interval_var(ws, dur_s, f'iv_{tag}')
                    )
                    nodes[i] = (cs, ce, wc)
                    task_ops.append((op, cs, ce, dur_s, dur_h, key))
                    # wskazówka: zachłanny harmonogram listowy (ZP w kolejności VIP/termin)
                    cmin = max((hint_ce[p] + (transfer_s if str(ops[p]['workcenter']) != wc else 0)
                                for p in preds[i]), default=0)
                    frees = free_at.setdefault(key, [0] * axis['K'])
                    k = frees.index(min(frees))
                    w = max(frees[k], bisect_left(axis['cal'], cmin))
                    if w <= W - dur_s:
                        frees[k] = w + dur_s
                        model.add_hint(ws, w)
                        hint_ce[i] = axis['cal'][w + dur_s - 1] + 1
                    else:
                        hint_ce[i] = total_slots

            # precedencje (+ transfer przy zmianie gniazda)
            cs_i = nodes[i][0]
            for p in preds[i]:
                _, ce_p, wc_p = nodes[p]
                tr = transfer_s if (wc_p != wc and transfer_s > 0) else 0
                model.add(cs_i >= ce_p + tr)

        if not task_ops:
            continue
        n_ops_total += len(task_ops)

        # ── MIĘKKI termin: tardiness = max(0, last_end - due_s) ──────────────
        zp_end = model.new_int_var(0, total_slots + 1, f'end_{zp_id}')
        for _, _, ce, _, _, _ in task_ops:
            model.add(zp_end >= ce)
        tard_var = model.new_int_var(0, total_slots + 1, f'tard_{zp_id}')
        model.add(tard_var >= zp_end - due_s)

        zp_tasks.append((zp, task_ops, due_s, weight))
        tard_terms.append((tard_var, weight))
        end_vars.append(zp_end)

    # ── 7. Ograniczenia zasobów (na osiach pracy) ─────────────────────────────
    for key, ivs in res_intervals.items():
        if not ivs:
            continue
        axis = axes[key]
        K = axis['K']
        if K <= 1:
            model.add_no_overlap(ivs)
        else:
            all_iv = list(ivs)
            demands = [1] * len(ivs)
            for off, ln, dem in axis['fillers']:
                all_iv.append(model.new_fixed_size_interval_var(off, ln, f'fill_{key}_{off}'))
                demands.append(dem)
            model.add_cumulative(all_iv, demands, K)
            print(f"[TARDINESS] Pool {key}: cumulative K={K}", file=sys.stderr)

    # ── 8. Funkcja celu: (1) ważone spóźnienie, (2) suma zakończeń ZP ────────
    big = max(1, len(end_vars)) * (total_slots + 1) + 1
    objective = big * sum(w * t for t, w in tard_terms) + sum(end_vars)
    model.minimize(objective)

    print(
        f"[TARDINESS] Model: {len(zp_tasks)} ZP, {n_ops_total} operacji, "
        f"{sum(len(v) for v in res_intervals.values())} intervals",
        file=sys.stderr
    )

    # ── 9. Solver ─────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers  = 4
    # probing/symetria: na modelach z elementami presolve zżerał kilka s przed 1. rozwiązaniem
    solver.parameters.cp_model_probing_level = 0
    solver.parameters.symmetry_level = 0
    if debug:
        solver.parameters.log_search_progress = True

    status      = solver.solve(model)
    status_name = {
        cp_model.OPTIMAL:    'OPTIMAL',
        cp_model.FEASIBLE:   'FEASIBLE',
        cp_model.INFEASIBLE: 'INFEASIBLE',
        cp_model.UNKNOWN:    'UNKNOWN',
    }.get(status, 'UNKNOWN')

    print(
        f"[TARDINESS] Status={status_name}, czas={solver.wall_time:.1f}s, "
        f"objective={solver.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 'N/A'}",
        file=sys.stderr
    )

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, status_name, solver.wall_time

    # ── 10. Buduj wyniki ──────────────────────────────────────────────────────
    fwd_zp    = []
    zp_status = []

    for zp, task_ops, due_s, weight in zp_tasks:
        due_dt_full = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(
            hour=23, minute=59, second=59
        )
        seq         = 0
        last_end_dt = None

        for op, cs, ce, dur_s, dur_h, key in task_ops:
            seq      += 1
            cs_v, ce_v = solver.value(cs), solver.value(ce)
            start_dt  = _slot_to_dt(cs_v, plan_start)
            end_dt    = _slot_to_dt(ce_v, plan_start)
            if last_end_dt is None or end_dt > last_end_dt:
                last_end_dt = end_dt

            if key is not None:
                raw = _segments_from_axis(axes[key], cs_v, ce_v)
            else:
                raw = [(cs_v, ce_v)]
            n_seg = len(raw)
            segments = []
            for a, b in raw:
                seg_h = (b - a) / SLOTS_H
                segments.append({
                    'segStart': _slot_to_dt(a, plan_start).isoformat(),
                    'segEnd':   _slot_to_dt(b, plan_start).isoformat(),
                    'durH':     dur_h if n_seg == 1 else seg_h,
                })

            fwd_zp.append({
                'zp_id':      f"{zp['zp_id']}/{str(seq).zfill(3)}",
                'parent_zp':  zp['zp_id'],
                'zs_id':      zp.get('zs_id', ''),
                'klient':     zp.get('klient', ''),
                'product':    zp.get('product', ''),
                'workcenter': str(op['workcenter']),
                'operation':  op.get('operation', op.get('machine_name', '')),
                'sequence':   op.get('sequence', 0),
                'volume':     zp.get('volume', 1),
                'durH':       dur_h,
                'start_dt':   start_dt.isoformat(),
                'end_dt':     end_dt.isoformat(),
                'segments':   segments,
                'due_date':   zp['due_date'],
                'priority':   zp.get('priority', 0),
                'realEnd':    end_dt.isoformat(),
            })

        if last_end_dt is None:
            continue

        delay_h = max(0.0, (last_end_dt - due_dt_full).total_seconds() / 3600)
        is_late = delay_h > 0

        zp_status.append({
            'zp_id':     zp['zp_id'],
            'zs_id':     zp.get('zs_id', ''),
            'klient':    zp.get('klient', ''),
            'product':   zp.get('product', ''),
            'due_date':  zp['due_date'],
            'priority':  zp.get('priority', 0),
            'realEnd':   last_end_dt.isoformat(),
            'delayH':    round(delay_h, 2),
            'delayDays': round(delay_h / DEFAULT_H, 1),
            'late':      is_late,
            'weight':    weight,
            'toc': {
                'zone':     'black' if is_late else 'green',
                'label':    'SPÓŹNIONE' if is_late else 'OK',
                'consumed': 1.0 if is_late else 0.0,
            },
        })

    result = {
        'fwdZP':         fwd_zp,
        'zpStatus':      zp_status,
        'cpStatus':      status_name,
        'wcUtilization': wc_util,
        'warnings':      warnings,
    }
    return result, status_name, solver.wall_time
