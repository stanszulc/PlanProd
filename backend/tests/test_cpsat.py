# Testy solvera CP-SAT (cpsat_tardiness.solve_tardiness) - wolane bezposrednio, bez HTTP.
# plan_start = poniedzialek 2026-08-17, 00:00; domyslny shiftStart = 6.
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cpsat_tardiness import solve_tardiness, _get_avail  # noqa: E402

MON = datetime(2026, 8, 17)
WEEK16 = [16, 16, 16, 16, 16, 0, 0]        # pn-pt po 16 h, weekend 0


def _op(wc, seq, dur_h, preds=None, uid=None):
    o = {'workcenter': wc, 'sequence': seq, 'ct_min': 0, '_durH': dur_h,
         'predecessors': preds if preds is not None else []}
    if uid is not None:
        o['_opUid'] = uid
    return o


def _zp(zp_id, product='P', due='2026-12-31', prio=2, vol=1):
    return {'zp_id': zp_id, 'product': product, 'volume': vol,
            'due_date': due, 'priority': prio}


def _run(zps, routing, sched, cfg=None, start=MON):
    c = {'cpSatTimeLimitSeconds': 5}
    c.update(cfg or {})
    res, status, _ = solve_tardiness(zps, routing, sched, start, c)
    assert res is not None, status
    return res


def _dt(s):
    return datetime.fromisoformat(s)


def _max_end(res):
    return max(_dt(o['end_dt']) for o in res['fwdZP'])


def _segments(res, wc=None):
    for o in res['fwdZP']:
        if wc is None or o['workcenter'] == wc:
            for s in o['segments']:
                yield _dt(s['segStart']), _dt(s['segEnd'])


def _hours_on_day(res, day):
    nxt = day + timedelta(days=1)
    return sum((min(e, nxt) - max(s, day)).total_seconds() / 3600
               for s, e in _segments(res) if s < nxt and e > day)


# -- 1. Pool 3xxxx: dzienny budzet godzin, bez limitu jednym operatorem --------

def test_pool_dwa_zp_po_10h_budzet_16h_na_dobe():
    zps = [_zp('A'), _zp('B')]
    routing = {'P': [_op('30001', 1, 10)]}
    res = _run(zps, routing, {'30001': WEEK16})
    end = _max_end(res)
    # 20 h pracy > budzet 16 h/dobe: koniec dopiero we wtorek (nie 20 h szeregowo
    # bez okna, nie rownolegle w jeden dzien)
    assert end > MON + timedelta(hours=22)           # po zakonczeniu okna poniedzialku
    assert end <= MON + timedelta(days=1, hours=10)  # 6 h w pn + 4 h we wt od 06:00
    assert _hours_on_day(res, MON) <= 16 + 1e-6


def test_pool_bez_limitu_jednym_operatorem():
    # gniazdo z budzetem 32 h/dobe - dwa ZP po 16 h moga isc rownolegle
    zps = [_zp('A'), _zp('B')]
    routing = {'P': [_op('30001', 1, 16)]}
    res = _run(zps, routing, {'30001': [32] * 5 + [0, 0]})
    assert _max_end(res) <= MON + timedelta(hours=24)    # oba jednego dnia
    starts = sorted(_dt(o['start_dt']) for o in res['fwdZP'])
    assert starts[0] == starts[1]                         # faktycznie rownolegle


def test_pool_brygada_wspolny_budzet_dwoch_gniazd():
    # dwa gniazda jednej brygady po 16 h = budzet 32 h; trzy ZP po 16 h:
    # dwa w pn rownolegle, trzeci we wtorek
    zps = [_zp('A', 'P1'), _zp('B', 'P2'), _zp('C', 'P1')]
    routing = {'P1': [_op('30001', 1, 16)], 'P2': [_op('30002', 1, 16)]}
    sched = {'30001': WEEK16, '30002': WEEK16}
    res = _run(zps, routing, sched,
               {'wcToBrygada': {'30001': 'B1', '30002': 'B1'}})
    assert _max_end(res) > MON + timedelta(hours=22)
    assert _hours_on_day(res, MON) <= 32 + 1e-6


# -- 2. Okna dostepnosci maszyn -------------------------------------------------

def test_maszyna_20h_omija_weekend_i_godziny_poza_oknem():
    friday = datetime(2026, 8, 21)
    res = _run([_zp('A')], {'P': [_op('20001', 1, 20)]}, {'20001': WEEK16}, start=friday)
    segs = list(_segments(res))
    assert segs
    for s, e in segs:
        last = e - timedelta(seconds=1)
        assert s.weekday() < 5 and last.weekday() < 5
        assert s.hour >= 6 and (e.hour < 22 or (e.hour == 22 and e.minute == 0))
        assert s.date() == last.date()                  # segment w obrebie doby
    # 16 h w piatek 06-22, 4 h w poniedzialek 06-10
    assert _max_end(res) == datetime(2026, 8, 24, 10, 0)


def test_maszyna_start_w_sobote_przesuwa_na_poniedzialek():
    sat = datetime(2026, 8, 22)
    res = _run([_zp('A')], {'P': [_op('20001', 1, 5)]}, {'20001': WEEK16}, start=sat)
    assert _dt(res['fwdZP'][0]['start_dt']) == datetime(2026, 8, 24, 6, 0)


def test_maszyna_24h_okno_przesuniete_przed_polnoc():
    res = _run([_zp('A')], {'P': [_op('20001', 1, 24)]}, {'20001': [24] * 7})
    o = res['fwdZP'][0]
    assert _dt(o['start_dt']) == MON
    assert _dt(o['end_dt']) == MON + timedelta(hours=24)


def test_maszyna_slownik_dat_bez_klucza_dzien_roboczy_16h():
    sched = {'20001': {'2026-08-17': 0}}      # poniedzialek wylaczony, reszta domyslna
    res = _run([_zp('A')], {'P': [_op('20001', 1, 4)]}, sched)
    assert _dt(res['fwdZP'][0]['start_dt']) == datetime(2026, 8, 18, 6, 0)


# -- 3. Predecessors, transfer, fallbacki ---------------------------------------

def _fan_routing(with_preds=True):
    def p(x):
        return x if with_preds else []
    return {'P': [_op('20001', 1, 4),
                  _op('20002', 2, 4, p([1])),
                  _op('20003', 3, 4, p([1])),
                  _op('20004', 4, 2, p([2, 3]))]}


def test_fan_out_fan_in_szybciej_niz_szeregowo():
    sched = {w: WEEK16 for w in ('20001', '20002', '20003', '20004')}
    graf = _run([_zp('A')], _fan_routing(True), sched)
    lancuch = _run([_zp('A')], _fan_routing(False), sched)
    # graf: 4 + 2 + 4 + 2 + 2 = 14 h od 06:00; lancuch: 4+2+4+2+4+2+2 = 20 h
    assert _max_end(graf) == MON + timedelta(hours=6 + 14)
    assert _max_end(graf) < _max_end(lancuch)
    assert graf['warnings'] == []
    ops = {o['workcenter']: o for o in graf['fwdZP']}
    assert _dt(ops['20002']['start_dt']) == _dt(ops['20001']['end_dt']) + timedelta(hours=2)
    assert _dt(ops['20003']['start_dt']) == _dt(ops['20001']['end_dt']) + timedelta(hours=2)


def test_transfer_w_lancuchu_tylko_gdy_zmiana_gniazda():
    routing = {'P': [_op('20001', 1, 2), _op('20001', 2, 2), _op('20002', 3, 2)]}
    res = _run([_zp('A')], routing, {'20001': WEEK16, '20002': WEEK16})
    # 2 + 2 (to samo gniazdo, bez transferu) + 2 h transfer + 2 = 8 h od 06:00
    assert _max_end(res) == MON + timedelta(hours=14)


def test_cykl_w_predecessors_warning_bez_wyjatku():
    routing = {'P': [_op('20001', 1, 2, [2]), _op('20002', 2, 2, [1])]}
    res = _run([_zp('A')], routing, {'20001': WEEK16, '20002': WEEK16})
    assert any('cykl' in w.lower() for w in res['warnings'])
    assert len(res['fwdZP']) == 2                     # fallback do lancucha po sequence


def test_duplikat_numeru_op_i_brakujacy_poprzednik_warning():
    dup = {'P': [_op('20001', 1, 2), _op('20002', 1, 2, [1])]}
    res = _run([_zp('A')], dup, {'20001': WEEK16, '20002': WEEK16})
    assert any('duplik' in w.lower() for w in res['warnings'])
    brak = {'P': [_op('20001', 1, 2), _op('20002', 2, 2, [99])]}
    res = _run([_zp('A')], brak, {'20001': WEEK16, '20002': WEEK16})
    assert any('brak' in w.lower() for w in res['warnings'])


def test_opuid_jako_klucz_operacji():
    routing = {'P': [_op('20001', 1, 4, uid='a'),
                     _op('20002', 2, 4, ['a'], uid='b'),
                     _op('20003', 3, 4, ['a'], uid='c')]}
    sched = {w: WEEK16 for w in ('20001', '20002', '20003')}
    res = _run([_zp('A')], routing, sched)
    assert res['warnings'] == []
    assert _max_end(res) == MON + timedelta(hours=6 + 4 + 2 + 4)   # b i c rownolegle


# -- 4. get_avail i delayDays ---------------------------------------------------

def test_get_avail_dict_bez_klucza_weekend_0_dzien_roboczy_16():
    sched = {'20001': {'2026-08-17': 8}}
    assert _get_avail('20001', '2026-08-17', sched) == 8
    assert _get_avail('20001', '2026-08-18', sched) == 16     # brak klucza, dzien roboczy
    assert _get_avail('20001', '2026-08-22', sched) == 0      # sobota
    assert _get_avail('20009', '2026-08-18', sched) == 16     # brak harmonogramu
    assert _get_avail('20009', '2026-08-23', sched) == 0
    assert _get_avail('20001', '2026-08-17', {'20001': [8, 0, 0, 0, 0, 0, 0]}) == 8


def test_delay_days_to_delay_h_przez_16():
    res = _run([_zp('A', due='2026-08-17')], {'P': [_op('20001', 1, 20)]}, {'20001': WEEK16})
    z = res['zpStatus'][0]
    assert z['late'] and z['delayH'] > 0
    assert z['delayDays'] == round(z['delayH'] / 16, 1)


# -- 5. Skalowanie --------------------------------------------------------------

def test_skalowanie_30_zp_5_operacji_zwraca_rozwiazanie():
    wcs = ['20001', '20002', '20003', '20004', '30001']
    routing = {'P': [_op(w, i + 1, 3) for i, w in enumerate(wcs)]}
    zps = [_zp(f'Z{i}', due=f'2026-09-{(i % 20) + 1:02d}', prio=1 if i % 7 == 0 else 2)
           for i in range(30)]
    sched = {w: WEEK16 for w in wcs}
    res, status, t = solve_tardiness(zps, routing, sched, MON, {'cpSatTimeLimitSeconds': 10})
    assert res is not None and status in ('OPTIMAL', 'FEASIBLE')
    assert len(res['fwdZP']) == 150
    assert t < 15
