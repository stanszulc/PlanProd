"""
PlanProd — optimizer.py
OR-Tools CP-SAT job shop scheduling + symulacja grafików

Podejście: czas operacji przeliczany z minut roboczych na minuty
kalendarzowe (z uwzględnieniem przerw nocnych). Solver operuje
na minutach kalendarzowych — brak konfliktów INFEASIBLE.

Uruchomienie:
  python optimizer.py
"""

from ortools.sat.python import cp_model
from datetime import datetime, timedelta
import io, csv
from itertools import product as iterproduct

# ---------------------------------------------------------------------------
# 1. DANE DEMO
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

# ---------------------------------------------------------------------------
# 2. PARSER
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
# 3. KALKULATOR KALENDARZA
#    Przelicza minuty robocze → minuty kalendarzowe
#    Operacje trwają tyle samo roboczo, ale w kalendarzu są dłuższe
#    bo solver widzi ciągły czas od 0
# ---------------------------------------------------------------------------

def work_to_cal(work_min, cap_h):
    """
    Przelicza minuty robocze na minuty kalendarzowe.
    Np. przy 8h: 490 min roboczych = 1 dzień (480) + 10 min
                 → 24h*60 + 10 = 1450 min kalendarzowych
    """
    if cap_h >= 24:
        return work_min
    day_work = cap_h * 60
    days     = work_min // day_work
    rem      = work_min % day_work
    return days * 24 * 60 + rem


def due_to_cal(due_dt, cap_h):
    """Przelicza datę terminu na minuty kalendarzowe od START_DT."""
    cal_days = (due_dt - START_DT).days
    return cal_days * 24 * 60 + cap_h * 60  # koniec ostatniego dnia roboczego


def cal_to_dt(cal_min):
    """Przelicza minuty kalendarzowe na datetime."""
    return START_DT + timedelta(minutes=cal_min)

# ---------------------------------------------------------------------------
# 4. SOLVER
# ---------------------------------------------------------------------------

def solve(zps, routing, wc_hours, time_limit=10.0):
    """
    Uruchamia CP-SAT z podanym grafikiem.
    Czasy operacji są przeliczone na minuty kalendarzowe.
    Zwraca (makespan_cal, zp_ends_cal) lub None.
    """
    model   = cp_model.CpModel()
    horizon = HORIZON_DAYS * 24 * 60

    all_tasks    = {}
    wc_intervals = {}

    for zp in zps:
        zp_id  = zp['zp_id']
        volume = zp['volume']
        for op in routing.get(zp['product'], []):
            seq        = op['seq']
            wc         = op['workcenter']
            cap_h      = wc_hours.get(wc, BASE_H)
            work_min   = max(1, int(op['ct_min'] * volume))
            cal_dur    = work_to_cal(work_min, cap_h)

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

    # No-overlap per centrum (bez blocked intervals — czas jest już kalendaryzowany)
    for wc, ivs in wc_intervals.items():
        if len(ivs) > 1:
            model.AddNoOverlap(ivs)

    # Makespan
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

    ms_val  = solver.Value(makespan)
    zp_ends = {}
    for (zp_id, seq), t in all_tasks.items():
        v = solver.Value(t['end'])
        if zp_id not in zp_ends or v > zp_ends[zp_id]:
            zp_ends[zp_id] = v

    return ms_val, zp_ends

# ---------------------------------------------------------------------------
# 5. LICZENIE SPÓŹNIONYCH
# ---------------------------------------------------------------------------

def count_tardy(zps, zp_ends, wc_hours):
    max_h = max(wc_hours.values())
    tardy = []
    for zp in zps:
        due_cal = due_to_cal(zp['due_date'], max_h)
        if zp_ends.get(zp['zp_id'], 0) > due_cal:
            tardy.append(zp['zp_id'])
    return tardy

# ---------------------------------------------------------------------------
# 6. SYMULACJA GRAFIKÓW
# ---------------------------------------------------------------------------

def simulate(zps, routing):
    # Krok 0: bazowy run → utilizacje
    base_hours = {wc: BASE_H for wc in ALL_WCS}
    res0 = solve(zps, routing, base_hours, time_limit=15.0)
    if res0 is None:
        print("❌ Bazowy plan nie znaleziony"); return

    ms0, ends0   = res0
    base_tardy   = count_tardy(zps, ends0, base_hours)

    # Proxy utilizacji: łączny czas roboczy / makespan_cal
    wc_load = {wc: 0 for wc in ALL_WCS}
    for zp in zps:
        for op in routing.get(zp['product'], []):
            wc_load[op['workcenter']] += int(op['ct_min'] * zp['volume'])

    candidates = [wc for wc in ALL_WCS if (wc_load[wc] / ms0) >= 0.40]

    print("=" * 70)
    print("SYMULACJA GRAFIKÓW — PlanProd OR-Tools CP-SAT")
    print("=" * 70)
    print(f"Bazowy makespan : {ms0/60:.1f}h kalendarzowych")
    print(f"Spóźnione ZP    : {len(base_tardy)} / {len(zps)}")
    print(f"Kandydaci (≥40%): {candidates}")

    SHIFT_OPTIONS = [BASE_H, 10, 12, 16]
    options = {wc: (SHIFT_OPTIONS if wc in candidates else [BASE_H]) for wc in ALL_WCS}
    combos  = list(iterproduct(*[options[wc] for wc in ALL_WCS]))
    print(f"Kombinacji      : {len(combos)}\n")

    results = []
    for idx, combo in enumerate(combos, 1):
        wc_hours = dict(zip(ALL_WCS, combo))
        res = solve(zps, routing, wc_hours, time_limit=8.0)
        if res is None:
            continue
        ms_val, zp_ends = res
        tardy   = count_tardy(zps, zp_ends, wc_hours)
        extra_h = sum(max(0, h - BASE_H) for h in wc_hours.values())
        results.append({
            'wc_hours': wc_hours, 'makespan': ms_val,
            'tardy': tardy, 'n_tardy': len(tardy),
            'extra_h': extra_h, 'zp_ends': zp_ends,
        })
        zmiany = [f"{wc}:{h}h" for wc, h in wc_hours.items() if h > BASE_H]
        print(f"  [{idx:>3}/{len(combos)}] {', '.join(zmiany) or 'bazowy':<30} "
              f"spóźnione: {len(tardy):>2}  makespan: {ms_val/60:>6.1f}h", flush=True)

    if not results:
        print("❌ Brak wyników"); return

    results.sort(key=lambda r: (r['n_tardy'], r['makespan'], r['extra_h']))

    # Tabela wyników
    print("\n" + "=" * 70)
    print(f"{'#':<4} {'Spóźnione':>10} {'Makespan h':>11} {'Nadgodz.':>9}  Rozszerzone centra")
    print("-" * 70)
    for i, r in enumerate(results[:10], 1):
        zmiany = [f"{wc}:{h}h" for wc, h in r['wc_hours'].items() if h > BASE_H]
        tag    = " ◀ TOP" if i <= 3 else ""
        print(f"{i:<4} {r['n_tardy']:>10} {r['makespan']/60:>10.1f}h {r['extra_h']:>9}h  "
              f"{', '.join(zmiany) or 'brak zmian'}{tag}")

    # Top 3 szczegóły
    print("\n" + "=" * 70)
    print("SZCZEGÓŁY TOP 3")
    print("=" * 70)

    for rank, r in enumerate(results[:3], 1):
        zmiany  = [f"{wc}:{h}h" for wc, h in r['wc_hours'].items() if h > BASE_H]
        max_h   = max(r['wc_hours'].values())
        print(f"\n{'─'*70}")
        print(f"#{rank}  Spóźnione: {r['n_tardy']} ZP | Makespan: {r['makespan']/60:.1f}h | Nadgodziny: {r['extra_h']}h/dzień łącznie")
        print(f"Grafik: {', '.join(zmiany) or 'bazowy'}")
        print(f"\n  {'ZP':<12} {'Termin':>12} {'Koniec plan':>13}  Status")
        for zp in sorted(zps, key=lambda x: x['due_date']):
            zp_id   = zp['zp_id']
            end_cal = r['zp_ends'].get(zp_id, 0)
            end_dt  = cal_to_dt(end_cal)
            due_cal = due_to_cal(zp['due_date'], max_h)
            status  = "✅ na czas" if end_cal <= due_cal else "❌ spóźnione"
            print(f"  {zp_id:<12} {zp['due_date'].strftime('%Y-%m-%d'):>12} "
                  f"{end_dt.strftime('%m-%d %H:%M'):>13}  {status}")

    return results


# ---------------------------------------------------------------------------
# 7. MAIN
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    routing = parse_routing(ROUTING_CSV)
    zps     = parse_zp(ZP_CSV)
    simulate(zps, routing)