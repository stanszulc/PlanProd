"""
server.py — FastAPI server dla PlanProd/FlowOps optimizer
Uruchomienie: py server.py   (http://localhost:8765)

Endpointy (POST): /optimize, /optimize/greedy, /optimize/sa, /optimize/cpsat-tardiness
Input:  { zpList, routingByProduct, wcSchedule, planStart, config }
Output: { fwdZP, zpStatus, lateCount, totalDelay, maxDelay, elapsed, method, warnings, ... }

Błędy: 422 (złe dane wejściowe wg modeli), 400 (niewykonalny model / dane,
które przeszły walidację, ale solver ich nie przyjął), 500 (nieoczekiwany błąd).

Greedy i SA to uproszczenia: nie obsługują puli brygadowej (gniazda 3xxxx)
ani grafu `predecessors` (fan-out/fan-in) — wtedy odpowiedź ma ostrzeżenie w `warnings`.
Pełny model (pula, graf) ma tylko /optimize/cpsat-tardiness.
"""
import logging, math, os, sys, bisect, time
from datetime import datetime, timedelta
from typing import Any, Optional, Union

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from ortools.sat.python import cp_model
from cpsat_tardiness import solve_tardiness

log = logging.getLogger('planprod.server')

app = FastAPI()

# ── CORS ─────────────────────────────────────────────────────────────────────
DEFAULT_CORS_PORTS = (5173, 5174, 3000)

def cors_origins():
    """Lista dozwolonych originów: PLANPROD_CORS_ORIGINS (po przecinku) lub localhost."""
    env = os.environ.get('PLANPROD_CORS_ORIGINS')
    if env:
        return [o.strip() for o in env.split(',') if o.strip()]
    return [f'http://{h}:{p}' for h in ('localhost', '127.0.0.1') for p in DEFAULT_CORS_PORTS]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── STAŁE ────────────────────────────────────────────────────────────────────
SLOT_MIN  = 15
S_PER_DAY = 24 * 60 // SLOT_MIN  # 96
# Domyślna dostępność (h) dnia roboczego bez grafiku — zgodna z frontendową WORK_DAY_H = 16
# (frontend/src/constants/schedule.js); delayDays = delayH / DEFAULT_H liczy "dni robocze".
DEFAULT_H = 16

# Górne granice parametrów od klienta (ochrona przed zablokowaniem serwera)
MAX_TIME_LIMIT_S  = 120   # s — limit czasu solverów
MAX_HORIZON_DAYS  = 120   # dni — horizonDays
MAX_JOBS_LIMIT    = 8000  # cpSatMaxJobs (tyle samo co MAX_JOBS w cpsat_tardiness)
_CFG_LIMITS = {           # klucz config -> (min, max)
    'cpSatTimeLimitSeconds': (1, MAX_TIME_LIMIT_S),
    'horizonDays':           (1, MAX_HORIZON_DAYS),
    'cpSatMaxJobs':          (1, MAX_JOBS_LIMIT),
    'vipBufferDays':         (0, 30),
    'vipWeight':             (0, 1000),
    'normalWeight':          (0, 1000),
}

def clamp_config(cfg):
    """Kopia config z parametrami liczbowymi obciętymi do rozsądnych granic.
    Wartość None = brak (solver użyje domyślnej). Nie-liczba -> ValueError (422)."""
    out = dict(cfg or {})
    for key, (lo, hi) in _CFG_LIMITS.items():
        if key not in out:
            continue
        v = out[key]
        if v is None:
            del out[key]
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f'config.{key} musi być liczbą (otrzymano: {v!r})')
        out[key] = max(lo, min(hi, v))
    return out

# ── HELPERS ──────────────────────────────────────────────────────────────────
def date_str(dt): return dt.strftime('%Y-%m-%d')

def get_avail(wc, ds, wc_sched):
    sc = wc_sched.get(str(wc))
    if sc is None:
        dt = datetime.strptime(ds, '%Y-%m-%d')
        return 0.0 if dt.weekday() >= 5 else DEFAULT_H
    if isinstance(sc, dict):
        # jak frontendowy getAvail: brak klucza daty = domyślnie (weekend 0, dzień roboczy DEFAULT_H)
        if ds in sc:
            return float(sc[ds])
        dt = datetime.strptime(ds, '%Y-%m-%d')
        return 0.0 if dt.weekday() >= 5 else DEFAULT_H
    if isinstance(sc, list):
        idx = datetime.strptime(ds, '%Y-%m-%d').weekday()
        return float(sc[idx]) if idx < len(sc) else 0.0
    return DEFAULT_H

def h2s(h):
    if h <= 0: return 0
    return max(1, math.ceil(h * 60 / SLOT_MIN))

def slot_to_dt(slot, plan_start):
    return plan_start + timedelta(days=slot // S_PER_DAY, minutes=(slot % S_PER_DAY) * SLOT_MIN)

# ── CP-SAT ───────────────────────────────────────────────────────────────────
def solve(zp_list, routing, wc_sched, plan_start, cfg):
    horizon    = min(cfg.get('horizonDays', 14) + 60, 120)
    vip_buf    = cfg.get('vipBufferDays', 2)
    time_limit = cfg.get('cpSatTimeLimitSeconds', 30)
    total_slots = horizon * S_PER_DAY

    # Zbierz WC
    wc_set = set()
    for zp in zp_list:
        for op in routing.get(zp.get('product', ''), []):
            wc_set.add(str(op['workcenter']))

    max_due = max((zp.get('due_date','') for zp in zp_list), default='')
    print(f"ZP: {len(zp_list)}, WC: {len(wc_set)}, horyzont: {horizon}d, max_due: {max_due}", file=sys.stderr)

    # Ogranicz do ZP w horyzoncie — tak samo jak JS scheduler
    horizon_end = plan_start + timedelta(days=horizon)
    zp_list_filtered = [
        zp for zp in zp_list
        if datetime.strptime(zp['due_date'], '%Y-%m-%d') <= horizon_end
    ]
    print(f"ZP po filtrze horyzontu: {len(zp_list_filtered)}", file=sys.stderr)

    # Dla dużych instancji — ogranicz do max 500 ZP (najpiniejsze wg due_date)
    if len(zp_list_filtered) > 500:
        zp_list_filtered = sorted(zp_list_filtered, key=lambda z: z.get('due_date',''))[:500]
        print(f"Ograniczono do 500 najpiniejszych ZP dla CP-SAT", file=sys.stderr)

    # Oblicz potrzebny horyzont z max due_date
    if max_due:
        try:
            max_due_dt = datetime.strptime(max_due, '%Y-%m-%d')
            needed = (max_due_dt - plan_start).days + 14
            if needed > horizon:
                horizon = min(needed, 180)
                total_slots = horizon * S_PER_DAY
                print(f"Rozszerzono horyzont do {horizon}d", file=sys.stderr)
        except:
            pass

    # Okna dostępności
    wc_windows = {}
    for wc in wc_set:
        wins = []
        for d in range(horizon):
            ds = date_str(plan_start + timedelta(days=d))
            ns = h2s(get_avail(wc, ds, wc_sched))
            if ns > 0:
                gs = d * S_PER_DAY
                wins.append((gs, gs + ns))
        wc_windows[wc] = wins

    model  = cp_model.CpModel()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers  = 4

    wc_ivals  = {wc: [] for wc in wc_set}
    zp_tasks  = []
    tard_vars = []

    for zp in zp_list_filtered:
        ops = sorted(routing.get(zp.get('product', ''), []), key=lambda o: o.get('sequence', 999))
        task_ops = []
        prev_end = None

        try:
            due_dt = datetime.strptime(zp['due_date'], '%Y-%m-%d')
            buf    = vip_buf if zp.get('priority', 0) == 1 else 0
            due_s  = max(0, (due_dt - plan_start).days - buf) * S_PER_DAY + S_PER_DAY - 1
        except:
            due_s = total_slots

        for op in ops:
            wc    = str(op['workcenter'])
            vol   = zp.get('volume', 1)
            ct    = op.get('ct_min', 0)
            dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
            dur_s = h2s(dur_h)
            if dur_s == 0 or wc not in wc_set:
                continue

            s  = model.new_int_var(0, total_slots,         f's_{zp["zp_id"]}_{op["sequence"]}')
            e  = model.new_int_var(0, total_slots + dur_s,  f'e_{zp["zp_id"]}_{op["sequence"]}')
            iv = model.new_interval_var(s, dur_s, e,        f'iv_{zp["zp_id"]}_{op["sequence"]}')

            if prev_end is not None:
                model.add(s >= prev_end)
            # Brak twardego constraintu dostępności — CP-SAT sam znajdzie sloty
            # wins = wc_windows.get(wc, [])

            wc_ivals[wc].append(iv)
            task_ops.append((op, s, e, dur_s, dur_h))
            prev_end = e

        if not task_ops:
            continue

        tard = model.new_int_var(0, total_slots, f'tard_{zp["zp_id"]}')
        # tard >= last_e - due_s  (tard >= 0 już z definicji)
        model.add(tard >= task_ops[-1][2] - due_s)
        zp_tasks.append((zp, task_ops, due_s))
        tard_vars.append(tard)

    for wc, ivals in wc_ivals.items():
        if ivals:
            model.add_no_overlap(ivals)

    model.minimize(sum(tard_vars))
    status = solver.solve(model)

    status_name = {
        cp_model.OPTIMAL:    'OPTIMAL',
        cp_model.FEASIBLE:   'FEASIBLE',
        cp_model.INFEASIBLE: 'INFEASIBLE',
        cp_model.UNKNOWN:    'UNKNOWN',
    }.get(status, 'UNKNOWN')

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, status_name, solver.wall_time

    # Buduj wyniki
    fwd_zp    = []
    zp_status = []

    for zp, task_ops, due_s in zp_tasks:
        due_dt_full = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(hour=23, minute=59, second=59)
        seq = 0
        last_end_dt = None

        for op, s_var, e_var, dur_s, dur_h in task_ops:
            seq += 1
            start_dt = slot_to_dt(solver.value(s_var), plan_start)
            end_dt   = slot_to_dt(solver.value(e_var),   plan_start)
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
                'segments':   [{'segStart': start_dt.isoformat(), 'segEnd': end_dt.isoformat(), 'durH': dur_h}],
                'due_date':   zp['due_date'],
                'priority':   zp.get('priority', 0),
                'realEnd':    end_dt.isoformat(),
            })

        if last_end_dt is None:
            continue

        delay_h = max(0, (last_end_dt - due_dt_full).total_seconds() / 3600)
        zp_status.append({
            'zp_id':     zp['zp_id'],
            'zs_id':     zp.get('zs_id', ''),
            'klient':    zp.get('klient', ''),
            'product':   zp.get('product', ''),
            'due_date':  zp['due_date'],
            'priority':  zp.get('priority', 0),
            'realEnd':   last_end_dt.isoformat(),
            'delayH':    delay_h,
            'delayDays': round(delay_h / DEFAULT_H, 1),
            'late':      delay_h > 0,
            'toc': {'zone': 'black' if delay_h > 0 else 'green', 'label': 'SPÓŹNIONE' if delay_h > 0 else 'OK', 'consumed': 1.0 if delay_h > 0 else 0.0},
        })

    return {'fwdZP': fwd_zp, 'zpStatus': zp_status, 'cpStatus': status_name}, status_name, solver.wall_time

# ── MODELE WEJŚCIA ───────────────────────────────────────────────────────────
Num = Union[int, float]

def _norm_date(v):
    if not isinstance(v, str):
        raise ValueError('data musi być tekstem YYYY-MM-DD')
    s = v.strip()[:10]
    datetime.strptime(s, '%Y-%m-%d')  # ValueError -> 422
    return s

class ZPModel(BaseModel):
    model_config = ConfigDict(extra='allow')
    zp_id:    Union[str, int]
    product:  str
    volume:   Optional[Num] = 1
    due_date: str
    priority: Optional[int] = 0

    @field_validator('due_date', mode='before')
    @classmethod
    def _due(cls, v): return _norm_date(v)

class OpModel(BaseModel):
    model_config = ConfigDict(extra='allow', populate_by_name=True)
    workcenter:   Union[str, int]
    sequence:     Optional[Num] = 0
    ct_min:       Optional[Num] = 0
    dur_h:        Optional[Num] = Field(None, alias='_durH')
    predecessors: Optional[list[Any]] = None

class OptimizeRequest(BaseModel):
    zpList: list[ZPModel]
    routingByProduct: dict[str, list[OpModel]]
    wcSchedule: dict[str, Optional[Union[list[Any], dict[str, Any]]]]
    planStart: str
    config: dict[str, Any] = {}

    @field_validator('planStart', mode='before')
    @classmethod
    def _ps(cls, v): return _norm_date(v)

    @field_validator('config', mode='before')
    @classmethod
    def _cfg(cls, v):
        if v is None:
            return {}
        if not isinstance(v, dict):
            raise ValueError('config musi być obiektem')
        return clamp_config(v)

    def plain(self):
        """(zp_list, routing, wc_sched, plan_start, cfg) jako zwykłe dict/list dla solverów."""
        zps = [z.model_dump(exclude_none=True) for z in self.zpList]
        routing = {k: [o.model_dump(exclude_none=True, by_alias=True) for o in ops]
                   for k, ops in self.routingByProduct.items()}
        wc = {k: v for k, v in self.wcSchedule.items() if v is not None}
        return zps, routing, wc, datetime.strptime(self.planStart, '%Y-%m-%d'), dict(self.config)

# ── OSTRZEŻENIA O UPROSZCZENIACH ─────────────────────────────────────────────
def simplification_warnings(zp_list, routing):
    """Ostrzeżenia dla metod bez grafu predecessors i puli brygadowej (greedy/SA)."""
    products = {z.get('product', '') for z in zp_list}
    fan, brig = set(), set()
    for p in products:
        ops = sorted(routing.get(p, []), key=lambda o: o.get('sequence', 999))
        prev_seq = None
        for op in ops:
            wc = str(op['workcenter'])
            if wc.startswith('3'):
                brig.add(wc)
            preds = op.get('predecessors') or []
            expected = set() if prev_seq is None else {prev_seq}
            if preds and set(preds) != expected:
                fan.add(p)
            prev_seq = op.get('sequence', 999)
    out = []
    if fan:
        out.append(f'Metoda uproszczona: {len(fan)} produkt(ów) ma `predecessors` inne niż prosty łańcuch '
                   f'(fan-out/fan-in) — operacje planowane sekwencyjnie wg `sequence`, wynik nieporównywalny 1:1 z CP-SAT.')
    if brig:
        out.append(f'Metoda uproszczona: gniazda brygadowe/pula ({", ".join(sorted(brig))}) '
                   f'traktowane jak zwykłe maszyny 1:1 (bez puli) — wynik nieporównywalny 1:1 z CP-SAT.')
    return out

# ── WSPÓLNA OBSŁUGA BŁĘDÓW ───────────────────────────────────────────────────
def _guard(label, func):
    """Uruchamia func(); błędy -> HTTPException (z logowaniem traceback)."""
    try:
        return func()
    except HTTPException:
        raise
    except (ValueError, KeyError, TypeError) as ex:
        log.exception('%s: błędne dane wejściowe', label)
        raise HTTPException(status_code=400, detail=f'Nieprawidłowe dane wejściowe ({label}): {ex!r}')
    except Exception as ex:
        log.exception('%s: nieoczekiwany błąd', label)
        raise HTTPException(status_code=500, detail=f'Błąd wewnętrzny ({label}): {ex}')

def _stats(status_list):
    return (sum(1 for z in status_list if z['late']),
            sum(z['delayH'] for z in status_list),
            max((z['delayH'] for z in status_list), default=0))

def _heuristic_response(method, req):
    zps, routing, wc, plan_start, cfg = req.plain()
    t0 = time.time()
    if method == 'greedy':
        fwd, status_list = schedule_greedy(zps, routing, wc, plan_start, cfg)
    else:
        time_limit = cfg.get('cpSatTimeLimitSeconds', 30)
        fwd, status_list = _sa_run(zps, routing, wc, plan_start, cfg, time_limit)
    late, total, mx = _stats(status_list)
    return {'fwdZP': fwd, 'zpStatus': status_list, 'lateCount': late, 'totalDelay': total,
            'maxDelay': mx, 'method': method, 'elapsed': round(time.time() - t0, 2),
            'warnings': simplification_warnings(zps, routing)}

def _cpsat_failure(status, hint=None):
    detail = f'Brak rozwiązania CP-SAT: {status}.'
    if hint:
        detail += ' ' + hint
    raise HTTPException(status_code=400, detail=detail)

# ── API ────────────────────────────────────────────────────────────────
# Zwykłe `def` (nie async) — FastAPI uruchamia je w puli wątków, więc długi solver
# nie blokuje pętli zdarzeń (/health odpowiada w trakcie liczenia).
@app.post('/optimize')
def optimize(req: OptimizeRequest):
    def run():
        method = req.config.get('method', 'cpsat')
        if method in ('greedy', 'sa'):
            return _heuristic_response(method, req)

        # Domyślnie CP-SAT
        zps_in, routing, wc, plan_start, cfg = req.plain()
        result, status, elapsed = solve_tardiness(zps_in, routing, wc, plan_start, cfg)
        if result is None:
            _cpsat_failure(status)

        zps = result['zpStatus']
        late_count, total_delay, max_delay = _stats(zps)
        return {
            **result,
            'warnings':   list(result.get('warnings') or []),
            'elapsed':    elapsed,
            'lateCount':  late_count,
            'totalDelay': total_delay,
            'maxDelay':   max_delay,
        }
    return _guard('optimize', run)

@app.get('/health')
def health():
    return {'status': 'ok'}


def schedule_greedy(zp_list, routing, wc_sched, plan_start, cfg, initial_order=None):
    """Forward scheduler identyczny z JS — używa tej samej logiki occupancy."""
    import heapq, bisect

    vip_buf = cfg.get('vipBufferDays', 2)
    horizon = min(cfg.get('horizonDays', 14) + 60, 120)

    # Occupancy per WC: lista (from_ms, to_ms) posortowana
    occ = {}  # wc -> [(from_ms, to_ms)]

    def get_avail_h(wc, date):
        ds = date_str(date)
        return get_avail(wc, ds, wc_sched)

    def find_slot(wc, start_dt, need_h):
        """Znajdź slot dla operacji — identyczna logika co JS findSlotForward."""
        cursor = start_dt
        remaining = need_h
        segs = []
        safety = 0

        while remaining > 0.001 and safety < 50000:
            safety += 1
            avail = get_avail_h(wc, cursor)
            if avail == 0:
                cursor = (cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                continue

            day_start = cursor.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(hours=min(avail, 24))

            if cursor >= day_end:
                cursor = (cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                continue

            # Przesuń za zajęte sloty
            wc_slots = occ.get(wc, [])
            window_start = cursor
            for (fs, te) in wc_slots:  # occ trzymane posortowane (bisect.insort)
                if fs <= window_start.timestamp() * 1000:
                    if te > window_start.timestamp() * 1000:
                        window_start = datetime.fromtimestamp(te / 1000)
                else:
                    break

            if window_start >= day_end:
                cursor = (cursor + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                continue

            # Znajdź koniec okna
            window_end = day_end
            for (fs, te) in wc_slots:
                fs_dt = datetime.fromtimestamp(fs / 1000)
                if fs_dt > window_start:
                    window_end = min(window_end, fs_dt)
                    break

            avail_h = (window_end - window_start).total_seconds() / 3600
            if avail_h <= 0.001:
                cursor = window_end
                continue

            take = min(remaining, avail_h)
            remaining -= take
            seg_end = window_start + timedelta(hours=take)
            segs.append((window_start, seg_end, take))

            # Dodaj do occupancy (bisect.insort = O(log n) zamiast sort O(n log n))
            if wc not in occ:
                occ[wc] = []
            bisect.insort(occ[wc], (window_start.timestamp() * 1000, seg_end.timestamp() * 1000))

            cursor = seg_end

        return segs

    def schedule_order(order):
        """Zaplanuj ZP w podanej kolejności, zwróć wyniki."""
        occ.clear()
        fwd = []
        status_list = []

        for zp in order:
            ops = sorted(routing.get(zp.get('product', ''), []), key=lambda o: o.get('sequence', 999))
            cursor = plan_start
            op_results = []

            for op in ops:
                wc = str(op['workcenter'])
                vol = zp.get('volume', 1)
                ct = op.get('ct_min', 0)
                dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
                if dur_h <= 0:
                    continue

                segs = find_slot(wc, cursor, dur_h)
                if segs:
                    cursor = segs[-1][1]
                    op_results.append((op, segs, dur_h))

            if not op_results:
                continue

            real_end = op_results[-1][1][-1][1]
            due_dt = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(hour=23, minute=59, second=59)
            delay_h = max(0, (real_end - due_dt).total_seconds() / 3600)

            seq = 0
            for op, segs, dur_h in op_results:
                seq += 1
                fwd.append({
                    'zp_id': f"{zp['zp_id']}/{str(seq).zfill(3)}",
                    'parent_zp': zp['zp_id'],
                    'zs_id': zp.get('zs_id', ''),
                    'klient': zp.get('klient', ''),
                    'product': zp.get('product', ''),
                    'workcenter': str(op['workcenter']),
                    'operation': op.get('operation', ''),
                    'sequence': op.get('sequence', 0),
                    'volume': zp.get('volume', 1),
                    'durH': dur_h,
                    'start_dt': segs[0][0].isoformat(),
                    'end_dt': segs[-1][1].isoformat(),
                    'segments': [{'segStart': s[0].isoformat(), 'segEnd': s[1].isoformat(), 'durH': s[2]} for s in segs],
                    'due_date': zp['due_date'],
                    'priority': zp.get('priority', 0),
                    'realEnd': real_end.isoformat(),
                })

            status_list.append({
                'zp_id': zp['zp_id'],
                'zs_id': zp.get('zs_id', ''),
                'klient': zp.get('klient', ''),
                'product': zp.get('product', ''),
                'due_date': zp['due_date'],
                'priority': zp.get('priority', 0),
                'realEnd': real_end.isoformat(),
                'delayH': delay_h,
                'delayDays': round(delay_h / DEFAULT_H, 1),
                'late': delay_h > 0,
                'toc': {'zone': 'black' if delay_h > 0 else 'green', 'label': 'SPÓŹNIONE' if delay_h > 0 else 'OK', 'consumed': 1.0 if delay_h > 0 else 0.0},
            })

        return fwd, status_list

    # EDD initial order
    edd_order = sorted(zp_list, key=lambda z: (z.get('due_date', ''), z.get('priority', 0)))
    fwd, status_list = schedule_order(edd_order)
    late  = sum(1 for z in status_list if z['late'])
    total = sum(z['delayH'] for z in status_list)
    print(f"Greedy EDD: spóźnionych={late}, suma={total:.1f}h", file=sys.stderr)

    return fwd, status_list  # zawsze 2 elementy


# ── SIMULATED ANNEALING ───────────────────────────────────────────────────────
def schedule_sa(zp_list, routing, wc_sched, plan_start, cfg, time_limit=30):
    """SA na kolejności ZP — minimalizuje liczbę spóźnionych."""
    import random, time, math as _math

    import bisect as _bisect
    # Cache dostępności - nie wywołuj get_avail za każdym razem
    _avail_cache = {}
    def _get_avail_cached(wc, ds):
        k = (wc, ds)
        if k not in _avail_cache:
            _avail_cache[k] = get_avail(wc, ds, wc_sched)
        return _avail_cache[k]

    def eval_order(order):
        """Szybka ocena kolejności — tylko zlicz spóźnione."""
        occ_sa = {}
        late = 0
        total_delay = 0

        for zp in order:
            ops = sorted(routing.get(zp.get('product', ''), []), key=lambda o: o.get('sequence', 999))
            cursor = plan_start
            real_end = plan_start

            for op in ops:
                wc = str(op['workcenter'])
                vol = zp.get('volume', 1)
                ct = op.get('ct_min', 0)
                dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
                if dur_h <= 0:
                    continue

                # Uproszczone szukanie slotu
                safety = 0
                remaining = dur_h
                c = cursor
                while remaining > 0.001 and safety < 10000:
                    safety += 1
                    avail = _get_avail_cached(wc, date_str(c))
                    if avail == 0:
                        c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                        continue
                    day_start = c.replace(hour=0, minute=0, second=0, microsecond=0)
                    day_end = day_start + timedelta(hours=min(avail, 24))
                    if c >= day_end:
                        c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                        continue

                    slots = occ_sa.get(wc, [])
                    ws = c
                    for fs, te in slots:
                        if fs <= ws:
                            if te > ws:
                                ws = te
                        else:
                            break
                    if ws >= day_end:
                        c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                        continue

                    we = day_end
                    for fs, te in slots:
                        if fs > ws:
                            we = min(we, fs)
                            break

                    ah = (we - ws).total_seconds() / 3600
                    if ah <= 0.001:
                        c = we
                        continue

                    take = min(remaining, ah)
                    remaining -= take
                    seg_end = ws + timedelta(hours=take)
                    if wc not in occ_sa:
                        occ_sa[wc] = []
                    bisect.insort(occ_sa[wc], (ws, seg_end))
                    c = seg_end
                    real_end = c
                cursor = real_end

            due_dt = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(hour=23, minute=59, second=59)
            delay = max(0, (real_end - due_dt).total_seconds() / 3600)
            if delay > 0:
                late += 1
                total_delay += delay

        return late, total_delay

    # Start od EDD
    current = sorted(zp_list, key=lambda z: z.get('due_date', ''))
    if len(current) < 2:
        # nie ma czego zamieniać
        return _final_schedule(current, routing, wc_sched, plan_start)
    best = current[:]
    best_late, best_total = eval_order(best)
    current_late, current_total = best_late, best_total

    print(f"SA start: spóźnionych={best_late}", file=sys.stderr)

    T = 1.0
    T_min = 0.01
    alpha = 0.995
    t0 = time.time()
    iters = 0

    # Pętla do wyczerpania time_limit; po wystygnięciu (T <= T_min) odgrzanie od najlepszego
    # rozwiązania. Wcześniej kończy się tylko gdy nie ma już spóźnień (nic do poprawy).
    while (time.time() - t0) < time_limit and best_late > 0:
        # Losowa zamiana dwóch ZP
        i, j = random.sample(range(len(current)), 2)
        current[i], current[j] = current[j], current[i]

        new_late, new_total = eval_order(current)

        # Akceptuj jeśli lepsze lub z prawdopodobieństwem
        delta = (new_late - current_late) + (new_total - current_total) * 0.001
        if delta < 0 or random.random() < _math.exp(-delta / T):
            current_late, current_total = new_late, new_total
            if new_late < best_late or (new_late == best_late and new_total < best_total):
                best = current[:]
                best_late, best_total = new_late, new_total
        else:
            current[i], current[j] = current[j], current[i]  # cofnij

        T *= alpha
        if T <= T_min:
            T = 1.0
            current = best[:]
            current_late, current_total = best_late, best_total
        iters += 1

    elapsed = time.time() - t0
    print(f"SA wynik: spóźnionych={best_late}, iteracji={iters}, czas={elapsed:.1f}s", file=sys.stderr)

    # Zaplanuj najlepszą kolejność
    return _final_schedule(best, routing, wc_sched, plan_start)


def _final_schedule(order, routing, wc_sched, plan_start):
    """Finalny forward schedule dla najlepszej kolejności SA."""
    occ = {}

    def get_avail_h(wc, date):
        return get_avail(wc, date_str(date), wc_sched)

    fwd = []
    status_list = []

    for zp in order:
        ops = sorted(routing.get(zp.get('product', ''), []), key=lambda o: o.get('sequence', 999))
        cursor = plan_start
        op_results = []

        for op in ops:
            wc = str(op['workcenter'])
            vol = zp.get('volume', 1)
            ct = op.get('ct_min', 0)
            dur_h = vol * ct / 60 if ct > 0 else op.get('_durH', 0)
            if dur_h <= 0:
                continue

            remaining = dur_h
            segs = []
            c = cursor
            safety = 0

            while remaining > 0.001 and safety < 50000:
                safety += 1
                avail = get_avail_h(wc, c)
                if avail == 0:
                    c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    continue
                day_start = c.replace(hour=0, minute=0, second=0, microsecond=0)
                day_end = day_start + timedelta(hours=min(avail, 24))
                if c >= day_end:
                    c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    continue
                slots = occ.get(wc, [])  # posortowane (bisect.insort)
                ws = c
                for fs, te in slots:
                    if fs <= ws:
                        if te > ws: ws = te
                    else: break
                if ws >= day_end:
                    c = (c + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
                    continue
                we = day_end
                for fs, te in slots:
                    if fs > ws: we = min(we, fs); break
                ah = (we - ws).total_seconds() / 3600
                if ah <= 0.001: c = we; continue
                take = min(remaining, ah)
                remaining -= take
                se = ws + timedelta(hours=take)
                segs.append((ws, se, take))
                if wc not in occ: occ[wc] = []
                bisect.insort(occ[wc], (ws, se))
                c = se

            if segs:
                cursor = segs[-1][1]
                op_results.append((op, segs, dur_h))

        if not op_results:
            continue

        real_end = op_results[-1][1][-1][1]
        due_dt = datetime.strptime(zp['due_date'], '%Y-%m-%d').replace(hour=23, minute=59, second=59)
        delay_h = max(0, (real_end - due_dt).total_seconds() / 3600)

        seq = 0
        for op, segs, dur_h in op_results:
            seq += 1
            fwd.append({
                'zp_id': f"{zp['zp_id']}/{str(seq).zfill(3)}",
                'parent_zp': zp['zp_id'],
                'zs_id': zp.get('zs_id', ''),
                'klient': zp.get('klient', ''),
                'product': zp.get('product', ''),
                'workcenter': str(op['workcenter']),
                'operation': op.get('operation', ''),
                'sequence': op.get('sequence', 0),
                'volume': zp.get('volume', 1),
                'durH': dur_h,
                'start_dt': segs[0][0].isoformat(),
                'end_dt': segs[-1][1].isoformat(),
                'segments': [{'segStart': s[0].isoformat(), 'segEnd': s[1].isoformat(), 'durH': s[2]} for s in segs],
                'due_date': zp['due_date'],
                'priority': zp.get('priority', 0),
                'realEnd': real_end.isoformat(),
            })

        status_list.append({
            'zp_id': zp['zp_id'],
            'zs_id': zp.get('zs_id', ''),
            'klient': zp.get('klient', ''),
            'product': zp.get('product', ''),
            'due_date': zp['due_date'],
            'priority': zp.get('priority', 0),
            'realEnd': real_end.isoformat(),
            'delayH': delay_h,
            'delayDays': round(delay_h / DEFAULT_H, 1),
            'late': delay_h > 0,
            'toc': {'zone': 'black' if delay_h > 0 else 'green', 'label': 'SPÓŹNIONE' if delay_h > 0 else 'OK', 'consumed': 1.0 if delay_h > 0 else 0.0},
        })

    return fwd, status_list


# ── ENDPOINTY ─────────────────────────────────────────────────────────────────
@app.post('/optimize/greedy')
def optimize_greedy(req: OptimizeRequest):
    return _guard('greedy', lambda: _heuristic_response('greedy', req))

@app.post('/optimize/sa')
def optimize_sa(req: OptimizeRequest):
    return _guard('sa', lambda: _heuristic_response('sa', req))

def _sa_run(zp_list, routing, wc_sched, plan_start, cfg, time_limit):
    fwd, status_list = schedule_sa(zp_list, routing, wc_sched, plan_start, cfg, time_limit)
    return fwd, status_list

@app.post('/optimize/cpsat-tardiness')
def optimize_cpsat_tardiness(req: OptimizeRequest):
    """
    CP-SAT z ważonym kosztem spóźnienia jako funkcją celu.

    Kluczowe różnice vs /optimize (stary CP-SAT):
      - terminy jako MIĘKKIE (tardiness = max(0, end - due)) — brak INFEASIBLE
      - wagi: VIP x5, normalne x1 — solver priorytetyzuje VIP
      - AddCumulative dla gniazd pool (3xxxx), AddNoOverlap dla maszyn 1:1
      - pre-check obciążenia gniazd w logu
      - zwraca wcUtilization per gniazdo

    Dodatkowe parametry w config:
      cpSatTimeLimitSeconds — domyślnie 60 (max MAX_TIME_LIMIT_S)
      cpSatMaxJobs          — domyślnie 800
      cpSatDebug            — True = pełny log solvera
      vipWeight             — waga VIP (domyślnie 5)
      normalWeight          — waga normalnych (domyślnie 1)
    """
    def run():
        zps_in, routing, wc, plan_start, cfg = req.plain()
        result, status, elapsed = solve_tardiness(zps_in, routing, wc, plan_start, cfg)
        if result is None:
            _cpsat_failure(status, 'INFEASIBLE przy miękkich terminach oznacza sprzeczność '
                                   'w sekwencji operacji (cykl w routingu?) lub brak danych.')

        zps         = result['zpStatus']
        late_count  = sum(1 for z in zps if z['late'])
        total_delay = round(sum(z['delayH'] for z in zps), 1)
        max_delay   = round(max((z['delayH'] for z in zps), default=0), 1)
        vip_late    = sum(1 for z in zps if z['late'] and z.get('priority', 0) == 1)

        return {
            **result,
            'warnings':   list(result.get('warnings') or []),
            'elapsed':    round(elapsed, 2),
            'lateCount':  late_count,
            'vipLate':    vip_late,
            'totalDelay': total_delay,
            'maxDelay':   max_delay,
            'method':     'cpsat-tardiness',
        }
    return _guard('cpsat-tardiness', run)

if __name__ == '__main__':
    print('FlowOps Optimizer — http://localhost:8765')
    uvicorn.run(app, host='127.0.0.1', port=8765)
