"""Deterministyczne dane do testu regresyjnego greedy (golden)."""
from datetime import datetime

PLAN_START = datetime(2026, 8, 17)


def make_case():
    zps = []
    for i in range(8):
        zps.append({
            'zp_id': f'Z{i}', 'product': 'PA' if i % 2 == 0 else 'PB',
            'volume': 10 + i * 7, 'due_date': f'2026-08-{18 + (i % 5)}',
            'priority': 1 if i % 3 == 0 else 2,
        })
    routing = {
        'PA': [{'workcenter': '20001', 'sequence': 1, 'ct_min': 6},
               {'workcenter': '20002', 'sequence': 2, 'ct_min': 0, '_durH': 5}],
        'PB': [{'workcenter': '20002', 'sequence': 1, 'ct_min': 9},
               {'workcenter': '20003', 'sequence': 2, 'ct_min': 4}],
    }
    sched = {'20001': [16, 16, 16, 16, 16, 0, 0], '20002': [8, 8, 8, 8, 8, 8, 0]}
    return zps, routing, sched
