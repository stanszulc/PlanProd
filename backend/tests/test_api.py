"""Testy API server.py (etap 4 audytu)."""
import copy
import inspect
import json
import os
import threading
import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import server

ENDPOINTS = ['/optimize/greedy', '/optimize/sa', '/optimize/cpsat-tardiness']
HERE = os.path.dirname(os.path.abspath(__file__))


# -- 1. Bledy HTTP i walidacja -------------------------------------------------
@pytest.mark.parametrize('ep', ENDPOINTS + ['/optimize'])
def test_poprawny_payload_200(client, payload, ep):
    r = client.post(ep, json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert 'error' not in j
    assert j['lateCount'] is not None


@pytest.mark.parametrize('ep', ENDPOINTS)
def test_zle_typy_422(client, payload, ep):
    assert client.post(ep, json={'zpList': 'zle'}).status_code == 422
    p = copy.deepcopy(payload)
    del p['zpList'][0]['due_date']
    assert client.post(ep, json=p).status_code == 422
    p = copy.deepcopy(payload)
    p['zpList'][0]['volume'] = 'abc'
    assert client.post(ep, json=p).status_code == 422
    p = copy.deepcopy(payload)
    del p['routingByProduct']['P1'][0]['workcenter']
    assert client.post(ep, json=p).status_code == 422


@pytest.mark.parametrize('ep', ENDPOINTS)
def test_zla_data_planstart_422(client, payload, ep):
    payload['planStart'] = 'jutro'
    assert client.post(ep, json=payload).status_code == 422


def test_zla_data_due_date_422(client, payload):
    payload['zpList'][0]['due_date'] = '01/09/2026'
    assert client.post('/optimize/greedy', json=payload).status_code == 422


def test_payload_frontendu_z_polami_dodatkowymi(client, payload):
    payload['zpList'][0].update({'_routingKey': 'P1', 'zs_id': 'ZS1', 'klient': 'K', 'x': {'a': 1}})
    op = payload['routingByProduct']['P1'][0]
    op.update({'_opUid': 'u1', 'operation': 'Ciecie', 'machine_name': 'M'})
    payload['config'].update({'urgencyMethod': 'atc', 'dowolny': [1, 2]})
    for ep in ENDPOINTS:
        r = client.post(ep, json=payload)
        assert r.status_code == 200, (ep, r.text)


def test_bez_predecessors_i_durH(client, payload):
    for op in payload['routingByProduct']['P1']:
        op.pop('predecessors')
        op.pop('_durH')
        op['ct_min'] = 30
    assert client.post('/optimize/greedy', json=payload).status_code == 200


def test_niewykonalny_model_400(client, payload, monkeypatch):
    monkeypatch.setattr(server, 'solve_tardiness', lambda *a, **k: (None, 'INFEASIBLE', 0.1))
    r = client.post('/optimize/cpsat-tardiness', json=payload)
    assert r.status_code == 400
    assert 'INFEASIBLE' in r.json()['detail']
    r = client.post('/optimize', json=payload)
    assert r.status_code == 400


def test_nieoczekiwany_wyjatek_500_i_log(client, payload, monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError('boom-solver')
    monkeypatch.setattr(server, 'solve_tardiness', boom)
    with caplog.at_level('ERROR'):
        r = client.post('/optimize/cpsat-tardiness', json=payload)
    assert r.status_code == 500
    assert 'detail' in r.json()
    assert any(rec.exc_info for rec in caplog.records)


def test_wyjatek_greedy_500(client, payload, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError('x')
    monkeypatch.setattr(server, 'schedule_greedy', boom)
    assert client.post('/optimize/greedy', json=payload).status_code == 500


# -- 3. Limity, blokowanie, clampy ---------------------------------------------
def test_clamp_konfiguracji():
    cfg = server.clamp_config({
        'cpSatTimeLimitSeconds': 99999, 'horizonDays': 9999, 'cpSatMaxJobs': 10**9,
        'vipBufferDays': -5, 'inne': 'x',
    })
    assert cfg['cpSatTimeLimitSeconds'] == server.MAX_TIME_LIMIT_S
    assert cfg['horizonDays'] == server.MAX_HORIZON_DAYS
    assert cfg['cpSatMaxJobs'] == server.MAX_JOBS_LIMIT
    assert cfg['vipBufferDays'] == 0
    assert cfg['inne'] == 'x'
    assert server.clamp_config({'cpSatTimeLimitSeconds': -3})['cpSatTimeLimitSeconds'] == 1
    assert 'horizonDays' not in server.clamp_config({})


def test_clamp_przekazany_do_solvera(client, payload, monkeypatch):
    seen = {}

    def fake(zp, routing, sched, ps, cfg):
        seen.update(cfg)
        return {'fwdZP': [], 'zpStatus': [], 'cpStatus': 'OPTIMAL'}, 'OPTIMAL', 0.0
    monkeypatch.setattr(server, 'solve_tardiness', fake)
    payload['config'].update({'cpSatTimeLimitSeconds': 100000, 'horizonDays': 5000, 'cpSatMaxJobs': 10**9})
    assert client.post('/optimize/cpsat-tardiness', json=payload).status_code == 200
    assert seen['cpSatTimeLimitSeconds'] == server.MAX_TIME_LIMIT_S
    assert seen['horizonDays'] == server.MAX_HORIZON_DAYS
    assert seen['cpSatMaxJobs'] == server.MAX_JOBS_LIMIT


def test_zla_wartosc_liczbowa_w_config_422(client, payload):
    payload['config']['cpSatTimeLimitSeconds'] = 'duzo'
    assert client.post('/optimize/greedy', json=payload).status_code == 422


def test_endpointy_nie_sa_async():
    for fn in (server.optimize, server.optimize_greedy, server.optimize_sa,
               server.optimize_cpsat_tardiness):
        assert not inspect.iscoroutinefunction(fn), fn.__name__


def test_health_odpowiada_w_trakcie_solvera(payload, monkeypatch):
    started = threading.Event()

    def slow(*a, **k):
        started.set()
        time.sleep(1.5)
        return {'fwdZP': [], 'zpStatus': [], 'cpStatus': 'OPTIMAL'}, 'OPTIMAL', 0.0
    monkeypatch.setattr(server, 'solve_tardiness', slow)
    c = TestClient(server.app)
    t = threading.Thread(target=lambda: c.post('/optimize/cpsat-tardiness', json=payload))
    t.start()
    assert started.wait(3)
    t0 = time.time()
    assert c.get('/health').status_code == 200
    assert time.time() - t0 < 0.8
    t.join()


def _late_case():
    zps = [{'zp_id': f'L{i}', 'product': 'P', 'volume': 1, 'due_date': '2026-08-17', 'priority': 2}
           for i in range(5)]
    routing = {'P': [{'workcenter': '1', 'sequence': 1, 'ct_min': 0, '_durH': 10}]}
    return zps, routing, {'1': [16] * 7}


def test_sa_respektuje_time_limit():
    zps, routing, sched = _late_case()
    t0 = time.time()
    fwd, st = server.schedule_sa(zps, routing, sched, datetime(2026, 8, 17), {}, time_limit=2)
    assert 1.7 <= time.time() - t0 < 6
    assert len(st) == 5


@pytest.mark.parametrize('n', [0, 1])
def test_sa_mniej_niz_2_zp(n):
    zps, routing, sched = _late_case()
    fwd, st = server.schedule_sa(zps[:n], routing, sched, datetime(2026, 8, 17), {}, time_limit=1)
    assert len(st) == n


def test_sa_konczy_gdy_brak_spoznien():
    zps = [{'zp_id': 'A', 'product': 'P', 'volume': 1, 'due_date': '2026-12-01', 'priority': 2},
           {'zp_id': 'B', 'product': 'P', 'volume': 1, 'due_date': '2026-12-02', 'priority': 2}]
    routing = {'P': [{'workcenter': '1', 'sequence': 1, 'ct_min': 0, '_durH': 1}]}
    t0 = time.time()
    server.schedule_sa(zps, routing, {'1': [16] * 7}, datetime(2026, 8, 17), {}, time_limit=30)
    assert time.time() - t0 < 5


def test_greedy_identyczny_z_wzorcem():
    from golden_data import PLAN_START, make_case
    zps, routing, sched = make_case()
    gold = json.load(open(os.path.join(HERE, 'golden_greedy.json'), encoding='utf-8'))
    fwd, st = server.schedule_greedy(zps, routing, sched, PLAN_START, {})
    assert json.loads(json.dumps([fwd, st])) == gold['greedy']
    fwd2, st2 = server._final_schedule(sorted(zps, key=lambda z: z['due_date']), routing, sched, PLAN_START)
    assert json.loads(json.dumps([fwd2, st2])) == gold['final']


def test_greedy_bez_sortowania_occ(monkeypatch):
    """Greedy nie powinien wolac sorted() na occ w kazdej iteracji."""
    import builtins
    from golden_data import PLAN_START, make_case
    zps, routing, sched = make_case()
    calls = {'n': 0}
    real = builtins.sorted

    def counting(it, *a, **k):
        calls['n'] += 1
        return real(it, *a, **k)
    monkeypatch.setitem(server.__dict__, 'sorted', counting)
    server.schedule_greedy(zps, routing, sched, PLAN_START, {})
    # tylko sortowanie EDD + sortowanie operacji po sequence (1 na ZP)
    assert calls['n'] <= 1 + len(zps)


# -- 4. get_avail --------------------------------------------------------------
def test_get_avail_dict_brak_klucza():
    sched = {'1': {'2026-08-17': 8}}   # 17.08.2026 = poniedzialek
    assert server.get_avail('1', '2026-08-17', sched) == 8.0
    assert server.get_avail('1', '2026-08-18', sched) == server.DEFAULT_H   # wtorek, brak klucza
    assert server.get_avail('1', '2026-08-22', sched) == 0.0                # sobota, brak klucza
    assert server.get_avail('1', '2026-08-18', {'1': {'2026-08-18': 0}}) == 0.0  # jawne 0 zostaje


def test_get_avail_pozostale_formy():
    assert server.get_avail('x', '2026-08-18', {}) == server.DEFAULT_H
    assert server.get_avail('x', '2026-08-22', {}) == 0.0
    assert server.get_avail('1', '2026-08-17', {'1': [4, 5, 6, 7, 8, 0, 0]}) == 4.0


def test_delay_days_spojne_z_dzien_roboczy():
    assert server.DEFAULT_H == 16
    zps = [{'zp_id': 'A', 'product': 'P', 'volume': 1, 'due_date': '2026-08-17', 'priority': 2}]
    routing = {'P': [{'workcenter': '1', 'sequence': 1, 'ct_min': 0, '_durH': 40}]}
    fwd, st = server.schedule_greedy(zps, routing, {'1': {'2026-08-17': 16}}, datetime(2026, 8, 17), {})
    z = st[0]
    assert z['delayDays'] == round(z['delayH'] / 16, 1)
    assert z['late']
    # dict bez klucza na dzien roboczy: 40h = 16+16+8 (wt, sr, czw) -> koniec w czwartek
    assert z['realEnd'].startswith('2026-08-19')


# -- 5. Ostrzezenia ------------------------------------------------------------
def test_brak_ostrzezen_dla_lancucha(client, payload):
    r = client.post('/optimize/greedy', json=payload).json()
    assert r['warnings'] == []


def test_ostrzezenie_predecessors_fan_in(client, payload):
    ops = payload['routingByProduct']['P1']
    ops.append({'workcenter': '20003', 'sequence': 3, 'ct_min': 0, '_durH': 1, 'predecessors': [1, 2]})
    for ep in ('/optimize/greedy', '/optimize/sa'):
        r = client.post(ep, json=payload).json()
        assert len(r['warnings']) == 1
        assert 'predecessors' in r['warnings'][0]


def test_ostrzezenie_brygada(client, payload):
    payload['routingByProduct']['P1'][1]['workcenter'] = '30001'
    payload['wcSchedule']['30001'] = [16] * 7
    for ep in ('/optimize/greedy', '/optimize/sa'):
        r = client.post(ep, json=payload).json()
        assert any('brygad' in w.lower() for w in r['warnings'])


def test_warnings_z_cpsat_przepuszczone(client, payload, monkeypatch):
    monkeypatch.setattr(server, 'solve_tardiness', lambda *a, **k: (
        {'fwdZP': [], 'zpStatus': [], 'cpStatus': 'OPTIMAL', 'warnings': ['uwaga solvera']}, 'OPTIMAL', 0.0))
    r = client.post('/optimize/cpsat-tardiness', json=payload).json()
    assert r['warnings'] == ['uwaga solvera']


def test_cpsat_bez_warnings_ma_pusta_liste(client, payload, monkeypatch):
    monkeypatch.setattr(server, 'solve_tardiness', lambda *a, **k: (
        {'fwdZP': [], 'zpStatus': [], 'cpStatus': 'OPTIMAL'}, 'OPTIMAL', 0.0))
    assert client.post('/optimize/cpsat-tardiness', json=payload).json()['warnings'] == []


# -- 6. CORS -------------------------------------------------------------------
@pytest.mark.parametrize('origin', ['http://localhost:5174', 'http://localhost:5173',
                                    'http://127.0.0.1:3000'])
def test_cors_preflight(client, origin):
    r = client.options('/optimize/greedy', headers={
        'Origin': origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'})
    assert r.headers.get('access-control-allow-origin') == origin


def test_cors_obcy_origin(client):
    r = client.options('/optimize/greedy', headers={
        'Origin': 'http://evil.example', 'Access-Control-Request-Method': 'POST'})
    assert 'access-control-allow-origin' not in r.headers


def test_cors_z_env(monkeypatch):
    monkeypatch.setenv('PLANPROD_CORS_ORIGINS', 'http://a.test, http://b.test')
    assert server.cors_origins() == ['http://a.test', 'http://b.test']
    monkeypatch.delenv('PLANPROD_CORS_ORIGINS')
    assert 'http://localhost:5174' in server.cors_origins()
