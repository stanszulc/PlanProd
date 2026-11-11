import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
from fastapi.testclient import TestClient

import server


@pytest.fixture(scope='module')
def client():
    return TestClient(server.app)


@pytest.fixture
def payload():
    return {
        'zpList': [
            {'zp_id': 'A', 'product': 'P1', 'volume': 1, 'due_date': '2026-09-01', 'priority': 2},
            {'zp_id': 'B', 'product': 'P1', 'volume': 1, 'due_date': '2026-09-02', 'priority': 1},
        ],
        'routingByProduct': {'P1': [
            {'workcenter': '20001', 'sequence': 1, 'ct_min': 0, '_durH': 5, 'predecessors': []},
            {'workcenter': '20002', 'sequence': 2, 'ct_min': 0, '_durH': 3, 'predecessors': [1]},
        ]},
        'wcSchedule': {'20001': [16] * 7, '20002': [16] * 7},
        'planStart': '2026-08-17',
        'config': {'cpSatTimeLimitSeconds': 5},
    }
