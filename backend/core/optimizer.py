"""
PlanProd — optimizer.py
OR-Tools CP-SAT solver — finite capacity job shop scheduling
Dane: demoData.js (ZP-001..007, routing 4 produkty, 5 centrów roboczych)

Cel: minimalizacja makespan (najwcześniejsze zakończenie wszystkich ZP)
Ograniczenia:
  - precedence: operacja N startuje po zakończeniu N-1 (lub N-2 przy parallel |)
  - capacity: każde centrum robocze przetwarza max 1 ZP w danym czasie
  - horizon: max 7 dni roboczych (2520 minut)

Uruchomienie:
  python optimizer.py

Docelowo: core/optimizer.py w PlanProd-backend (FastAPI)
"""

from ortools.sat.python import cp_model
from datetime import datetime, timedelta
import io
import csv

# ---------------------------------------------------------------------------
# 1. DANE DEMO (przepisane z demoData.js)
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

WORKCENTER_CAPACITY_H = 8  # godzin/dzień


# ---------------------------------------------------------------------------
# 2. PARSER
# ---------------------------------------------------------------------------

def parse_routing(csv_text):
    """Zwraca dict: product -> list of {seq, operation, workcenter, ct_min, predecessors}"""
    routing = {}
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    for row in reader:
        p = row['product']
        if p not in routing:
            routing[p] = []
        preds = []
        if row['predecessors'].strip():
            for pred in row['predecessors'].strip().split('|'):
                preds.append(int(pred.strip()))
        routing[p].append({
            'seq':        int(row['sequence']),
            'operation':  row['operation'],
            'workcenter': row['workcenter'],
            'ct_min':     float(row['ct_min']),
            'predecessors': preds,
        })
    for p in routing:
        routing[p].sort(key=lambda x: x['seq'])
    return routing


def parse_zp(csv_text):
    """Zwraca listę ZP z przeliczonym czasem trwania operacji (ct_min * volume)"""
    zps = []
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    for row in reader:
        zps.append({
            'zp_id':    row['zp_id'],
            'product':  row['product'],
            'volume':   int(row['volume']),
            'due_date': datetime.strptime(row['due_date'], '%Y-%m-%d'),
            'priority': int(row['priority']),
        })
    return zps


# ---------------------------------------------------------------------------
# 3. BUDOWANIE MODELU CP-SAT
# ---------------------------------------------------------------------------

def build_schedule(zps, routing, horizon_days=30):
    """
    Job Shop Scheduling z OR-Tools CP-SAT.

    Każde ZP = job, każda operacja = task.
    Zmienne: start_var, end_var, interval_var per (zp, operacja).
    Ograniczenia:
      - precedence między operacjami tego samego ZP
      - no-overlap na każdym centrum roboczym (finite capacity)
    Cel: minimalizacja makespan (max end_var wszystkich tasków).
    """
    model = cp_model.CpModel()

    horizon = horizon_days * WORKCENTER_CAPACITY_H * 60  # minuty

    # Struktury pomocnicze
    all_tasks = {}      # (zp_id, seq) -> {start, end, interval}
    wc_intervals = {}   # workcenter -> [interval_var]

    for zp in zps:
        product = zp['product']
        zp_id   = zp['zp_id']
        volume  = zp['volume']
        ops     = routing.get(product, [])

        for op in ops:
            seq = op['seq']
            # Czas trwania: ct_min * volume (minuty całkowite)
            duration = int(op['ct_min'] * volume)
            if duration < 1:
                duration = 1

            suffix = f"_{zp_id}_op{seq}"
            start_var    = model.NewIntVar(0, horizon, f"start{suffix}")
            end_var      = model.NewIntVar(0, horizon, f"end{suffix}")
            interval_var = model.NewIntervalVar(start_var, duration, end_var, f"interval{suffix}")

            all_tasks[(zp_id, seq)] = {
                'start':    start_var,
                'end':      end_var,
                'interval': interval_var,
                'duration': duration,
                'wc':       op['workcenter'],
                'op_name':  op['operation'],
            }

            wc = op['workcenter']
            if wc not in wc_intervals:
                wc_intervals[wc] = []
            wc_intervals[wc].append(interval_var)

    # Ograniczenia precedencji
    for zp in zps:
        product = zp['product']
        zp_id   = zp['zp_id']
        ops     = routing.get(product, [])

        for op in ops:
            seq   = op['seq']
            preds = op['predecessors']
            if not preds:
                continue
            for pred_seq in preds:
                if (zp_id, pred_seq) in all_tasks and (zp_id, seq) in all_tasks:
                    model.Add(
                        all_tasks[(zp_id, seq)]['start'] >=
                        all_tasks[(zp_id, pred_seq)]['end']
                    )

    # No-overlap na centrum roboczym (finite capacity = 1 ZP na raz)
    for wc, intervals in wc_intervals.items():
        model.AddNoOverlap(intervals)

    # Cel: minimalizacja makespan
    makespan = model.NewIntVar(0, horizon, 'makespan')
    model.AddMaxEquality(makespan, [
        t['end'] for t in all_tasks.values()
    ])
    model.Minimize(makespan)

    return model, all_tasks, makespan


# ---------------------------------------------------------------------------
# 4. SOLVE I WYNIKI
# ---------------------------------------------------------------------------

def solve_and_print(zps, routing):
    print("=" * 70)
    print("PlanProd — OR-Tools CP-SAT Job Shop Optimizer")
    print("=" * 70)

    model, all_tasks, makespan_var = build_schedule(zps, routing)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0
    solver.parameters.num_search_workers  = 4
    solver.parameters.log_search_progress = False

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print("❌ Brak rozwiązania!")
        return

    tag = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
    makespan_h = solver.Value(makespan_var) / 60
    print(f"\n✅ Rozwiązanie: {tag}")
    print(f"   Makespan: {makespan_h:.1f} h ({makespan_h/8:.1f} dni roboczych)\n")

    # Harmonogram per centrum robocze
    print(f"{'Centrum':<8} {'ZP':<12} {'Operacja':<42} {'Start':>8} {'Koniec':>8} {'Czas h':>6}")
    print("-" * 90)

    rows = []
    for (zp_id, seq), task in all_tasks.items():
        rows.append({
            'wc':      task['wc'],
            'zp_id':   zp_id,
            'op':      task['op_name'],
            'start':   solver.Value(task['start']),
            'end':     solver.Value(task['end']),
            'dur_min': task['duration'],
        })

    rows.sort(key=lambda r: (r['wc'], r['start']))

    current_wc = None
    for r in rows:
        if r['wc'] != current_wc:
            if current_wc is not None:
                print()
            current_wc = r['wc']

        start_h = r['start'] / 60
        end_h   = r['end'] / 60
        dur_h   = r['dur_min'] / 60
        print(f"{r['wc']:<8} {r['zp_id']:<12} {r['op'][:42]:<42} {start_h:>7.1f}h {end_h:>7.1f}h {dur_h:>5.1f}h")

    # Analiza terminowości per ZP
    print("\n" + "=" * 70)
    print("Analiza terminowości ZP")
    print("=" * 70)
    print(f"{'ZP':<12} {'Termin':>12} {'Koniec planu':>14} {'Status':<12} {'Opóźnienie':>12}")
    print("-" * 65)

    # Szukamy max end per ZP
    zp_ends = {}
    for (zp_id, seq), task in all_tasks.items():
        end_val = solver.Value(task['end'])
        if zp_id not in zp_ends or end_val > zp_ends[zp_id]:
            zp_ends[zp_id] = end_val

    start_dt = datetime(2026, 5, 22, 7, 0)  # start harmonogramu

    for zp in sorted(zps, key=lambda x: x['due_date']):
        zp_id    = zp['zp_id']
        due      = zp['due_date']
        end_min  = zp_ends.get(zp_id, 0)
        end_dt   = start_dt + timedelta(minutes=end_min)

        # Przybliżony termin w minutach od startu (dni robocze 8h)
        due_days = (due - start_dt).days
        due_min  = due_days * WORKCENTER_CAPACITY_H * 60

        if end_min <= due_min:
            status = "✅ NA CZAS"
            delay  = ""
        else:
            delay_h = (end_min - due_min) / 60
            status  = "❌ OPÓŹNIENIE"
            delay   = f"+{delay_h:.1f}h"

        print(f"{zp_id:<12} {due.strftime('%Y-%m-%d'):>12} {end_dt.strftime('%m-%d %H:%M'):>14}  {status:<14} {delay:>10}")

    # Obciążenie centrów roboczych
    print("\n" + "=" * 70)
    print("Obciążenie centrów roboczych")
    print("=" * 70)
    print(f"{'Centrum':<10} {'Łączny czas h':>14} {'Makespan h':>12} {'Utilizacja %':>13}")
    print("-" * 52)

    wc_load = {}
    for r in rows:
        wc_load[r['wc']] = wc_load.get(r['wc'], 0) + r['dur_min']

    for wc in sorted(wc_load):
        load_h = wc_load[wc] / 60
        util   = (wc_load[wc] / solver.Value(makespan_var)) * 100 if solver.Value(makespan_var) > 0 else 0
        print(f"{wc:<10} {load_h:>14.1f} {makespan_h:>12.1f} {util:>12.1f}%")

    print(f"\n{'WĄSKIE GARDŁO (CCR)':}")
    max_wc  = max(wc_load, key=wc_load.get)
    max_h   = wc_load[max_wc] / 60
    print(f"  → {max_wc} ({max_h:.1f}h łącznego czasu operacji)")

    print("\n" + "=" * 70)
    print(f"Solver stats: {solver.WallTime():.2f}s | branches: {solver.NumBranches()}")
    print("=" * 70)


# ---------------------------------------------------------------------------
# 5. MAIN
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    routing = parse_routing(ROUTING_CSV)
    zps     = parse_zp(ZP_CSV)
    solve_and_print(zps, routing)
