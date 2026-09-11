"""Focused L5 persistence contract; isolated schema on the disposable DB only."""
import hashlib
import json
import os
import unittest
import uuid
from pathlib import Path
import psycopg

TERMS = dict(amount=10, currency='USD', billingUnit='month', commitmentMonths=0,
             promo=False, renewalAmount=10, tax='exclusive', region='id-jkt',
             deploymentId='dep-a', vcpu=2, ramGb=4, storageGb=40, storageType='ssd', comparable=True)
KEYS = ['currency','billing_unit','commitment_months','promo','renewal_amount','tax_state','region','deployment_id','vcpu','ram_gb','storage_gb','storage_type']

@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'disposable TEST_DATABASE_URL required')
class PriceBasketL5(unittest.TestCase):
    def test_persisted_terms_hash_and_missing_fail_closed(self):
        with psycopg.connect(os.environ['TEST_DATABASE_URL']) as conn:
            schema = 'l5_' + uuid.uuid4().hex
            conn.execute(f'CREATE SCHEMA {schema}')
            conn.execute(f'SET LOCAL search_path TO {schema}, public')
            conn.execute('CREATE TABLE publication_receipts (after_value jsonb)')
            sql = Path('migrations/0014_structured_price_terms.sql').read_text()
            conn.execute(sql)
            def insert(value):
                return conn.execute('INSERT INTO publication_receipts(after_value) VALUES (%s::jsonb) RETURNING price_terms, basket_fingerprint', (json.dumps(value),)).fetchone()
            terms, fingerprint = insert(TERMS)
            self.assertTrue(terms['comparable'])
            self.assertEqual(terms['amount'], 10)
            self.assertEqual(set(terms), set(KEYS + ['amount','comparable']))
            expected = hashlib.sha256(json.dumps(['USD','month','0','false','10','exclusive','id-jkt','dep-a','2','4','40','ssd']).encode()).hexdigest()
            self.assertEqual(fingerprint, expected)
            self.assertEqual(insert({**TERMS, 'amount': 20})[1], fingerprint)
            for key in TERMS:
                missing = dict(TERMS); del missing[key]
                self.assertFalse(insert(missing)[0]['comparable'], key)
            for key, value in dict(currency='SGD', billingUnit='year', commitmentMonths=12, promo=True, renewalAmount=20, tax='inclusive', region='sg', deploymentId='dep-b', vcpu=4, ramGb=8, storageGb=80, storageType='hdd').items():
                self.assertNotEqual(insert({**TERMS, key: value})[1], fingerprint, key)
            self.assertFalse(insert({**TERMS, 'billingUnit': 'request'})[0]['comparable'])
            self.assertFalse(insert({**TERMS, 'comparable': 'true'})[0]['comparable'])
            conn.rollback()
