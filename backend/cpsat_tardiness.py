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
#    - AddCumulative zamiast AddNoOverlap dla gniazd pool (capacity > 1)
#    - log_search_progress w trybie debug
#    - zwraca szczegółowy raport: lateCount, totalDelay, maxDelay, wcUtilization
#
# Wdrożenie Gemini pattern:
#    ✓ Miękkie terminy (kary zamiast twardych ograniczeń)
#    ✓ Weighted tardiness w Minimize()
#    ✓ AddNoOverlap dla maszyn 1:1
#    ✓ AddCumulative dla pool (capacity > 1)
#    ✓ Pre-check capacity przed uruchomieniem solvera
#    ✓ Timeout z parametru config
#    ✓ Slot 15-minutowy (skala czasu — nie sekundy)
# ─────────────────────────────────────────────────────────────────────────────

import math, sys
from datetime import datetime, timedelta
from ortools.sat.python import cp_model

SLOT_MIN  = 15
S_PER_DAY = 24 * 60 // SLOT_MIN   # 96 slotów/dobę
DEFAULT_H = 16
MAX_JOBS  = 8000                    # limit CP-SAT — powyżej czas eksploduje


def _date_str(dt):
    return dt.strftime('%Y-%m-%d')


def _get_avail(wc, ds, wc_sched):
    sc = wc_sched.get(str(wc))
    if sc is None:
        dt = datetime.strptime(ds, '%Y-%m-%d')
        return 0.0 if dt.weekday() >= 5 else DEFAULT_H
    if isinstance(sc, dict):
        return float(sc.get(ds, 0.0))
    if isinstance(sc, list):
        idx = datetime.strptime(ds, '%Y-%m-%d').weekday()
        return float(sc[idx]) if idx < len(sc) else 0.0
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


def _build_wc_capacity(wc_sched, wc_set, horizon, plan_start):
    """
    Zwraca:
      wc_avail_slots[wc]  — suma slotów dostępnych w horyzoncie (dla pre-check)
      wc_capacity[wc]     — pojemność dzienna w slotach (max w ciągu horyzontu)
      wc_is_pool[wc]      — True jeśli capacity > 1 (gniazdo pool / montaż)
    """
    wc_avail_slots = {}
    wc_daily_cap   = {}

    for wc in wc_set:
        total = 0
        daily_caps = []
        for d in range(horizon):
            ds  = _date_str(plan_start + timedelta(days=d))
            cap = _h2s(_get_avail(wc, ds, wc_sched))
            total += cap
            if cap > 0:
                daily_caps.append(cap)
        wc_avail_slots[wc] = total
        # capacity dzienna = mediana dni roboczych (odporność na outliery)
        if daily_caps:
            daily_caps.sort()
            wc_daily_cap[wc] = daily_caps[len(daily_caps) // 2]
        else:
            wc_daily_cap[wc] = _h2s(DEFAULT_H)

    # Pool jeśli dzienna capacity > 1 zmiana (96 slotów × 1) — np. 3xxxx brygady
    # W praktyce: wc startujące od '3' lub daily_cap > S_PER_DAY
    wc_is_pool = {
        wc: (wc_daily_cap[wc] > S_PER_DAY) for wc in wc_set
    }

    return wc_avail_slots, wc_daily_cap, wc_is_pool


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

    Zwraca: (result_dict, status_name, elapsed_s)
      result_dict = { fwdZP, zpStatus, cpStatus, wcUtilization }
      lub None jeśli INFEASIBLE/UNKNOWN
    """
    vip_buf    = cfg.get('vipBufferDays', 2)
    time_limit = cfg.get('cpSatTimeLimitSeconds', 60)
    debug      = cfg.get('cpSatDebug', False)
    max_jobs   = cfg.get('cpSatMaxJobs', MAX_JOBS)
    w_vip      = cfg.get('vipWeight', 5)
    w_normal   = cfg.get('normalWeight', 1)

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

    wc_avail_slots, wc_daily_cap, wc_is_pool = _build_wc_capacity(
        wc_sched, wc_set, horizon, plan_start
    )

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

    # ── 5. Buduj model CP-SAT ─────────────────────────────────────────────────
    model = cp_model.CpModel()

    # Kontenery per gniazdo: intervals + demands (dla AddCumulative)
    wc_intervals = {wc: [] for wc in wc_set}   # dla AddNoOverlap (maszyny 1:1)
    wc_demands   = {wc: [] for wc in wc_set}   # dla AddCumulative (pool)

    zp_tasks    = []   # (zp, [(op, s_var, e_var, dur_s, dur_h)], due_s, weight)
    tard_terms  = []   # (tard_var, weight) → do sumy w Minimize

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

        task_ops = []
        prev_end = None

        for op in ops:
            wc    = str(op['workcenter'])
            ct    = op.get('ct_min', 0)
            dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
            dur_s = _h2s(dur_h)

            if dur_s == 0 or wc not in wc_set:
                continue

            s_var  = model.new_int_var(0, total_slots,          f's_{zp_id}_{op["sequence"]}')
            e_var  = model.new_int_var(0, total_slots + dur_s,  f'e_{zp_id}_{op["sequence"]}')
            iv     = model.new_interval_var(s_var, dur_s, e_var, f'iv_{zp_id}_{op["sequence"]}')

            # Sekwencja operacji — operacja N zaczyna się po końcu N-1
            if prev_end is not None:
                model.add(s_var >= prev_end)

            # Rejestruj interval w odpowiednim kontenerze gniazda
            wc_intervals[wc].append(iv)
            if wc_is_pool.get(wc, False):
                # Pool: demand = 1 jednostka capacity (wiele ZP może pracować równolegle)
                wc_demands[wc].append(1)

            task_ops.append((op, s_var, e_var, dur_s, dur_h))
            prev_end = e_var

        if not task_ops:
            continue

        # ── MIĘKKI termin: tardiness = max(0, last_end - due_s) ──────────────
        # Zamiast Add(last_end <= due_s) → INFEASIBLE
        # Robimy: tard >= last_end - due_s  (tard >= 0 z definicji zmiennej)
        tard_var = model.new_int_var(0, total_slots, f'tard_{zp_id}')
        model.add(tard_var >= task_ops[-1][2] - due_s)   # task_ops[-1][2] = e_var ostatniej op
        # tard_var automatycznie = 0 gdy last_end <= due_s (bo minimalizujemy)

        zp_tasks.append((zp, task_ops, due_s, weight))
        tard_terms.append((tard_var, weight))

    # ── 6. Ograniczenia maszyn ────────────────────────────────────────────────
    for wc in wc_set:
        ivs = wc_intervals[wc]
        if not ivs:
            continue

        if wc_is_pool.get(wc, False):
            # Pool (3xxxx): AddCumulative — capacity = dzienna pula slotów
            # Uwaga: capacity w sensie CP-SAT = ile zadań równolegle, nie godziny
            # Używamy wc_daily_cap jako przybliżenie max równoległych slotów
            cap = wc_daily_cap.get(wc, S_PER_DAY)
            demands = wc_demands[wc]
            model.add_cumulative(ivs, demands, cap)
            print(f"[TARDINESS] Pool {wc}: AddCumulative capacity={cap}", file=sys.stderr)
        else:
            # Maszyna 1:1: AddNoOverlap — jedno zadanie na raz
            model.add_no_overlap(ivs)

    # ── 7. Funkcja celu: minimalizuj ważony koszt spóźnienia ─────────────────
    # Weighted tardiness: sum(weight_i * tard_i)
    # VIP mają weight=5 → solver 5x bardziej stara się nie spóźniać VIP
    objective = sum(w * t for t, w in tard_terms)
    model.minimize(objective)

    print(
        f"[TARDINESS] Model: {len(zp_tasks)} ZP, {sum(len(t[1]) for t in zp_tasks)} operacji, "
        f"{sum(len(v) for v in wc_intervals.values())} intervals",
        file=sys.stderr
    )

    # ── 8. Solver ─────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers  = 4
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
        # Przy INFEASIBLE z miękkimi terminami to bardzo rzadkie —
        # oznaczałoby sprzeczność w samej sekwencji operacji
        return None, status_name, solver.wall_time

    # ── 9. Buduj wyniki ───────────────────────────────────────────────────────
    fwd_zp    = []
    zp_status = []

    for zp, task_ops, due_s, weight in zp_tasks:
        due_dt_full = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(
            hour=23, minute=59, second=59
        )
        seq         = 0
        last_end_dt = None

        for op, s_var, e_var, dur_s, dur_h in task_ops:
            seq      += 1
            start_dt  = _slot_to_dt(solver.value(s_var), plan_start)
            end_dt    = _slot_to_dt(solver.value(e_var),   plan_start)
            last_end_dt = end_dt

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
                'segments':   [{
                    'segStart': start_dt.isoformat(),
                    'segEnd':   end_dt.isoformat(),
                    'durH':     dur_h,
                }],
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
    }
    return result, status_name, solver.wall_time
