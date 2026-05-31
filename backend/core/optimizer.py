"""
PlanProd — optimizer.py v2
Faza 1: brute force stały grafik → top 3
Faza 2: greedy per dzień na CCR → minimalizacja łącznych nadgodzin
Porównanie faz.
"""

from ortools.sat.python import cp_model
from datetime import datetime, timedelta
import io, csv
from itertools import product as iterproduct

# ---------------------------------------------------------------------------
# DANE DEMO
# ---------------------------------------------------------------------------

ROUTING_CSV = """product,operation,workcenter,ct_min,sequence,predecessors
P-KOD-100-100,Wycinanie laserowe podstawy,G-01,3.0,1,
P-KOD-100-100,Gięcie profili podstawy,G-02,8.0,2,1
P-KOD-100-100,Spawanie narożników korpusu,G-03,6.0,3,
P-KOD-100-100,Izolacja PIR i montaż poliwęglanu,G-04,12.0,4,3
P-KOD-100-100,Montaż siłownika i testy KJ,G-05,15.0,5,2|4
P-TLU-KUL-01,Wycinanie paneli obudowy,G-01,5.0,1,
P-TLU-KUL-01,Gięcie obudowy zewnętrznej,G-02,4.0,2,
P-TLU-KUL-01,Spawanie i zgrzewanie obudowy,G-03,15.0,3,
P-TLU-KUL-01,Napełnianie kulis wełną,G-04,20.0,4,
P-TLU-KUL-01,Montaż końcowy i nitowanie,G-05,10.0,5,
P-SKR-ROZ-02,Wycinanie obudowy skrzynki,G-01,1.0,1,
P-SKR-ROZ-02,Gięcie skrzynki,G-02,2.0,2,
P-SKR-ROZ-02,Zgrzewanie liniowe korpusu,G-03,2.0,3,
P-SKR-ROZ-02,Wyklejanie matą kauczukową,G-04,5.0,4,
P-SKR-ROZ-02,Montaż króćców i przepustnicy,G-05,4.0,5,
P-KRA-MAS-03,Wycinanie ramki i lameli,G-01,0.4,1,
P-KRA-MAS-03,Gięcie ramki i profilowanie,G-02,0.6,2,
P-KRA-MAS-03,Montaż uszczelki i sprężynek,G-04,1.5,3,
P-KRA-MAS-03,Składanie żaluzji i nitowanie,G-05,3.0,4,"""

ZP_CSV = """zp_id,product,volume,due_date,priority
ZP-001,P-KOD-100-100,30,2026-05-25,1
ZP-002,P-KRA-MAS-03,100,2026-05-25,4
ZP-003,P-SKR-ROZ-02,50,2026-05-25,3
ZP-004,P-TLU-KUL-01,25,2026-05-25,2
ZP-005,P-KOD-100-100,20,2026-05-26,1
ZP-006,P-KRA-MAS-03,150,2026-05-26,4
ZP-007,P-SKR-ROZ-02,60,2026-05-26,3
ZP-008,P-TLU-KUL-01,30,2026-05-26,2
ZP-009,P-KOD-100-100,40,2026-05-27,1
ZP-010,P-KRA-MAS-03,80,2026-05-27,4
ZP-011,P-SKR-ROZ-02,40,2026-05-27,3
ZP-012,P-TLU-KUL-01,20,2026-05-27,2"""

ALL_WCS      = ['G-01', 'G-02', 'G-03', 'G-04', 'G-05']
BASE_H       = 8
HORIZON_DAYS = 30
START_DT     = datetime(2026, 5, 22, 7, 0)
MAX_H        = 16
STEP_H       = 2

# ---------------------------------------------------------------------------
# PARSER
# ---------------------------------------------------------------------------

def parse_routing(csv_text):
    routing = {}
    for row in csv.DictReader(io.StringIO(csv_text.strip())):
        p = row['product']
        routing.setdefault(p, []).append({
            'seq':          int(row['sequence']),
            'operation':    row['operation'],
            'workcenter':   row['workcenter'],
            'ct_min':       float(row['ct_min']),
            'predecessors': [int(x) for x in row['predecessors'].strip().split('|') if x.strip()],
        })
    for p in routing:
        routing[p].sort(key=lambda x: x['seq'])
    return routing

def parse_zp(csv_text):
    zps = []
    for row in csv.DictReader(io.StringIO(csv_text.strip())):
        zps.append({
            'zp_id':    row['zp_id'],
            'product':  row['product'],
            'volume':   int(row['volume']),
            'due_date': datetime.strptime(row['due_date'], '%Y-%m-%d'),
            'priority': int(row['priority']),
        })
    return zps

# ---------------------------------------------------------------------------
# KALKULATOR KALENDARZA
# wc_schedule: dict {wc: [h_day0, h_day1, ...]} — godziny per dzień per centrum
# ---------------------------------------------------------------------------

def work_to_cal_schedule(work_min, wc, wc_schedule):
    """
    Przelicza minuty robocze na minuty kalendarzowe
    uwzględniając zmienny grafik per dzień.
    wc_schedule[wc] = lista godzin per dzień
    """
    hours_per_day = wc_schedule.get(wc, [BASE_H] * HORIZON_DAYS)
    remaining = work_min
    cal_min   = 0
    for day, h in enumerate(hours_per_day):
        day_work = h * 60
        if remaining <= day_work:
            cal_min = day * 24 * 60 + remaining
            return cal_min
        remaining -= day_work
        cal_min = (day + 1) * 24 * 60
    return cal_min  # jeśli nie zmieściliśmy — koniec horyzontu


def flat_schedule(wc_hours_const):
    """Konwertuje stały grafik {wc: h} na listę per dzień."""
    return {wc: [h] * HORIZON_DAYS for wc, h in wc_hours_const.items()}


def due_to_cal(due_dt, wc_schedule):
    """Termin w minutach kalendarzowych — koniec dnia roboczego."""
    max_h    = max(v[0] for v in wc_schedule.values())
    cal_days = (due_dt - START_DT).days
    return cal_days * 24 * 60 + max_h * 60


def cal_to_dt(cal_min):
    return START_DT + timedelta(minutes=cal_min)

# ---------------------------------------------------------------------------
# SOLVER
# ---------------------------------------------------------------------------

def solve(zps, routing, wc_schedule, time_limit=10.0):
    """
    wc_schedule: {wc: [h_day0, h_day1, ...]}
    Zwraca (makespan_cal, zp_ends, task_ends) lub None.
    task_ends: {(zp_id, seq): end_cal}
    """
    model   = cp_model.CpModel()
    horizon = HORIZON_DAYS * 24 * 60

    all_tasks    = {}
    wc_intervals = {}

    for zp in zps:
        zp_id  = zp['zp_id']
        volume = zp['volume']
        for op in routing.get(zp['product'], []):
            seq      = op['seq']
            wc       = op['workcenter']
            work_min = max(1, int(op['ct_min'] * volume))
            cal_dur  = work_to_cal_schedule(work_min, wc, wc_schedule)

            sfx = f"_{zp_id}_s{seq}"
            s   = model.NewIntVar(0, horizon, f"s{sfx}")
            e   = model.NewIntVar(0, horizon, f"e{sfx}")
            iv  = model.NewIntervalVar(s, cal_dur, e, f"iv{sfx}")

            all_tasks[(zp_id, seq)] = {
                'start': s, 'end': e, 'interval': iv,
                'cal_dur': cal_dur, 'wc': wc,
            }
            wc_intervals.setdefault(wc, []).append(iv)

    # Precedencje
    for zp in zps:
        zp_id = zp['zp_id']
        for op in routing.get(zp['product'], []):
            for ps in op['predecessors']:
                if (zp_id, ps) in all_tasks and (zp_id, op['seq']) in all_tasks:
                    model.Add(
                        all_tasks[(zp_id, op['seq'])]['start'] >=
                        all_tasks[(zp_id, ps)]['end']
                    )

    # No-overlap
    for wc, ivs in wc_intervals.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    makespan = model.NewIntVar(0, horizon, 'ms')
    model.AddMaxEquality(makespan, [t['end'] for t in all_tasks.values()])
    model.Minimize(makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.log_search_progress = False
    solver.parameters.num_search_workers  = 4
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    ms_val    = solver.Value(makespan)
    zp_ends   = {}
    task_ends = {}
    for (zp_id, seq), t in all_tasks.items():
        v = solver.Value(t['end'])
        task_ends[(zp_id, seq)] = v
        if zp_id not in zp_ends or v > zp_ends[zp_id]:
            zp_ends[zp_id] = v

    return ms_val, zp_ends, task_ends


def count_tardy(zps, zp_ends, wc_schedule):
    tardy = []
    for zp in zps:
        due_cal = due_to_cal(zp['due_date'], wc_schedule)
        if zp_ends.get(zp['zp_id'], 0) > due_cal:
            tardy.append(zp['zp_id'])
    return tardy


def total_overtime(wc_schedule):
    """Łączna suma nadgodzin we wszystkich dniach i centrach."""
    total = 0
    for wc, days in wc_schedule.items():
        for h in days:
            total += max(0, h - BASE_H)
    return total

# ---------------------------------------------------------------------------
# FAZA 1 — stały grafik brute force
# ---------------------------------------------------------------------------

def faza1(zps, routing):
    print("=" * 70)
    print("FAZA 1 — brute force stały grafik")
    print("=" * 70)

    base_sched = flat_schedule({wc: BASE_H for wc in ALL_WCS})
    res0 = solve(zps, routing, base_sched, time_limit=15.0)
    if res0 is None:
        print("❌ Bazowy plan nie znaleziony"); return None

    ms0, ends0, _ = res0
    base_tardy    = count_tardy(zps, ends0, base_sched)

    wc_load = {wc: 0 for wc in ALL_WCS}
    for zp in zps:
        for op in routing.get(zp['product'], []):
            wc_load[op['workcenter']] += int(op['ct_min'] * zp['volume'])

    candidates = [wc for wc in ALL_WCS if (wc_load[wc] / ms0) >= 0.40]

    print(f"Bazowy makespan : {ms0/60:.1f}h | Spóźnione: {len(base_tardy)}/{len(zps)}")
    print(f"Kandydaci CCR   : {candidates}")

    SHIFT_OPTIONS = list(range(BASE_H, MAX_H + 1, STEP_H))
    options = {wc: (SHIFT_OPTIONS if wc in candidates else [BASE_H]) for wc in ALL_WCS}
    combos  = list(iterproduct(*[options[wc] for wc in ALL_WCS]))
    print(f"Kombinacji      : {len(combos)}\n")

    results = []
    for idx, combo in enumerate(combos, 1):
        wc_hours   = dict(zip(ALL_WCS, combo))
        wc_sched   = flat_schedule(wc_hours)
        res = solve(zps, routing, wc_sched, time_limit=8.0)
        if res is None:
            continue
        ms_val, zp_ends, _ = res
        tardy   = count_tardy(zps, zp_ends, wc_sched)
        ot      = total_overtime(wc_sched)
        zmiany  = [f"{wc}:{h}h" for wc, h in wc_hours.items() if h > BASE_H]
        results.append({
            'wc_hours': wc_hours, 'wc_sched': wc_sched,
            'makespan': ms_val, 'tardy': tardy,
            'n_tardy': len(tardy), 'overtime': ot,
            'zp_ends': zp_ends,
        })
        print(f"  [{idx:>3}/{len(combos)}] {', '.join(zmiany) or 'bazowy':<30} "
              f"spóźnione: {len(tardy):>2}  nadgodziny: {ot:>4}h łącznie", flush=True)

    results.sort(key=lambda r: (r['n_tardy'], r['overtime'], r['makespan']))

    print(f"\n{'#':<4} {'Spóźnione':>10} {'Nadgodz. łącznie':>17} {'Makespan h':>11}  Grafik")
    print("-" * 75)
    for i, r in enumerate(results[:5], 1):
        zmiany = [f"{wc}:{h}h" for wc, h in r['wc_hours'].items() if h > BASE_H]
        tag    = " ◀" if i <= 3 else ""
        ot_days = r['overtime'] // HORIZON_DAYS if r['overtime'] > 0 else 0
        print(f"{i:<4} {r['n_tardy']:>10} {r['overtime']:>10}h ({ot_days}h/dzień) "
              f"{r['makespan']/60:>10.1f}h  {', '.join(zmiany) or 'bazowy'}{tag}")

    best = results[0] if results else None
    return results, candidates

# ---------------------------------------------------------------------------
# FAZA 2 — greedy per dzień na CCR
# ---------------------------------------------------------------------------

def faza2(zps, routing, candidates, faza1_best):
    print("\n" + "=" * 70)
    print("FAZA 2 — greedy per dzień na CCR")
    print("=" * 70)

    # Start: bazowy grafik (8h wszędzie każdego dnia)
    wc_sched = {wc: [BASE_H] * HORIZON_DAYS for wc in ALL_WCS}

    iteration  = 0
    max_iter   = HORIZON_DAYS * len(candidates) * len(range(BASE_H, MAX_H + 1, STEP_H))

    print(f"Kandydaci CCR: {candidates}")
    print(f"Szukam minimalnego grafiku dziennego...\n")

    while iteration < max_iter:
        res = solve(zps, routing, wc_sched, time_limit=10.0)
        if res is None:
            print("❌ Solver nie znalazł rozwiązania"); break

        ms_val, zp_ends, task_ends = res
        tardy = count_tardy(zps, zp_ends, wc_sched)

        if len(tardy) == 0:
            break  # sukces

        # Znajdź dzień z największym obciążeniem CCR (greedy: atakuj najbardziej zajęty dzień)
        best_gain = 0
        best_wc   = None
        best_day  = None

        for wc in candidates:
            # Policz obciążenie per dzień dla tego centrum
            wc_load_per_day = [0] * HORIZON_DAYS
            for (zp_id, seq), t_end in task_ends.items():
                # Sprawdź czy ta operacja jest na tym centrum
                # Przybliżenie: na podstawie cal_end znajdź dzień
                day = min(t_end // (24 * 60), HORIZON_DAYS - 1)
                # TODO: dokładne przypisanie per centrum - na razie proxy
                wc_load_per_day[day] += 1

            for day in range(HORIZON_DAYS):
                current_h = wc_sched[wc][day]
                if current_h >= MAX_H:
                    continue
                # Ile spóźnionych ZP ma termin po tym dniu?
                day_dt    = START_DT + timedelta(days=day)
                relevant  = sum(1 for zp_id in tardy
                                if any(z['zp_id'] == zp_id and z['due_date'] >= day_dt
                                       for z in zps))
                if relevant > best_gain:
                    best_gain = relevant
                    best_wc   = wc
                    best_day  = day

        if best_wc is None:
            # Fallback: dodaj do pierwszego dostępnego dnia pierwszego kandydata
            for wc in candidates:
                for day in range(HORIZON_DAYS):
                    if wc_sched[wc][day] < MAX_H:
                        best_wc  = wc
                        best_day = day
                        break
                if best_wc:
                    break

        if best_wc is None:
            print("Osiągnięto maksimum godzin na wszystkich dniach"); break

        wc_sched[best_wc][best_day] += STEP_H
        iteration += 1

        ot = total_overtime(wc_sched)
        day_dt = START_DT + timedelta(days=best_day)
        print(f"  iter {iteration:>3}: +{STEP_H}h do {best_wc} "
              f"dnia {day_dt.strftime('%d.%m')} → "
              f"spóźnione: {len(tardy)}  nadgodziny łącznie: {ot}h", flush=True)

    # Wynik fazy 2
    res_final = solve(zps, routing, wc_sched, time_limit=15.0)
    if res_final is None:
        print("❌ Brak finalnego rozwiązania"); return None

    ms_final, ends_final, _ = res_final
    tardy_final = count_tardy(zps, ends_final, wc_sched)
    ot_final    = total_overtime(wc_sched)

    print(f"\nWynik fazy 2:")
    print(f"  Spóźnione    : {len(tardy_final)} ZP")
    print(f"  Makespan     : {ms_final/60:.1f}h")
    print(f"  Nadgodziny   : {ot_final}h łącznie")

    # Grafik dzienny (tylko dni z nadgodzinami)
    print(f"\n  Grafik dzienny (tylko dni z nadgodzinami na CCR):")
    for wc in candidates:
        zmiany_dni = [(START_DT + timedelta(days=d)).strftime('%d.%m') + f":{h}h"
                      for d, h in enumerate(wc_sched[wc]) if h > BASE_H]
        if zmiany_dni:
            print(f"    {wc}: {', '.join(zmiany_dni)}")

    return wc_sched, ot_final, len(tardy_final)

# ---------------------------------------------------------------------------
# PORÓWNANIE
# ---------------------------------------------------------------------------

def porownanie(f1_results, f2_ot, f2_tardy):
    print("\n" + "=" * 70)
    print("PORÓWNANIE FAZA 1 vs FAZA 2")
    print("=" * 70)

    f1_best = f1_results[0]
    f1_ot   = f1_best['overtime']

    print(f"\n{'':20} {'Faza 1 (stały grafik)':>22} {'Faza 2 (greedy/dzień)':>22}")
    print("-" * 66)
    print(f"{'Spóźnione ZP':<20} {f1_best['n_tardy']:>22} {f2_tardy:>22}")
    print(f"{'Nadgodziny łącznie':<20} {f1_ot:>21}h {f2_ot:>21}h")
    saving = f1_ot - f2_ot
    pct    = (saving / f1_ot * 100) if f1_ot > 0 else 0
    print(f"{'Oszczędność':<20} {'—':>22} {saving:>20}h ({pct:.0f}%)")
    print(f"{'Makespan':<20} {f1_best['makespan']/60:>21.1f}h {'—':>22}")

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    routing = parse_routing(ROUTING_CSV)
    zps     = parse_zp(ZP_CSV)

    f1_out = faza1(zps, routing)
    if f1_out is None:
        exit()

    f1_results, candidates = f1_out

    f2_out = faza2(zps, routing, candidates, f1_results[0])
    if f2_out is None:
        exit()

    wc_sched_f2, f2_ot, f2_tardy = f2_out
    porownanie(f1_results, f2_ot, f2_tardy)