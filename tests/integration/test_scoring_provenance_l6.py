"""Focused L6 scoring_run identity; isolated schema on the disposable DB only."""
import os
import unittest
import uuid
from pathlib import Path
import psycopg

IDENTITY_SQL = """
SELECT DISTINCT ON (offering_id, deployment_id, data_revision, methodology_id)
  id, composite::float, data_revision, methodology_id, offering_id, deployment_id, created_at
FROM scoring_runs
WHERE offering_id = %s AND deployment_id = %s AND data_revision = %s AND methodology_id = %s
ORDER BY offering_id, deployment_id, data_revision, methodology_id, created_at DESC, id DESC
"""

COMPONENTS_SQL = """
SELECT scoring_run_id, dimension, value::float
FROM score_components
WHERE scoring_run_id = ANY(%s)
"""

@unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'disposable TEST_DATABASE_URL required')
class ScoringProvenanceL6(unittest.TestCase):
    def test_latest_run_and_components_share_exact_identity(self):
        with psycopg.connect(os.environ['TEST_DATABASE_URL']) as conn:
            schema = 'l6_' + uuid.uuid4().hex
            conn.execute(f'CREATE SCHEMA {schema}')
            conn.execute(f'SET LOCAL search_path TO {schema}, public')
            conn.execute(Path('migrations/0008_scoring_runs.sql').read_text())
            methodology = 'asean-offering-deployment-v1'
            ruleset = 'aac738a238205ce9967b448e2609bcc9d9c0b6de944783337d1b1bf6e5b79739'
            def insert_run(run_id, revision, composite, created):
                conn.execute(
                    """INSERT INTO scoring_runs (
                         id, methodology_id, algorithm_version, ruleset_hash, data_revision,
                         subject_type, subject_id, offering_id, deployment_id, provider_id,
                         recommendation_group, composite, ranking_lower_bound, uncertainty,
                         reason_codes, engine, created_at
                       ) VALUES (
                         %s, %s, '1.0.0', %s, %s,
                         'offering_deployment', 'off-a:dep-a', 'off-a', 'dep-a', 'prov-a',
                         'eligible', %s, %s, 0.1, '{}', 'canonical', %s
                       )""",
                    (run_id, methodology, ruleset, revision, composite, composite, created),
                )
                conn.execute(
                    """INSERT INTO score_components (
                         scoring_run_id, dimension, knowledge_state, value, weight, uncertainty, reason_codes
                       ) VALUES (%s, 'primary_data_residency', 'present', %s, 15, 0.1, '{}')""",
                    (run_id, composite),
                )
            insert_run('run-old', 'rev-old', 0.11, '2026-01-01T00:00:00Z')
            insert_run('run-new', 'rev-new', 0.88, '2026-02-01T00:00:00Z')
            insert_run('run-newer-same', 'rev-new', 0.91, '2026-03-01T00:00:00Z')
            latest_new = conn.execute(IDENTITY_SQL, ('off-a', 'dep-a', 'rev-new', methodology)).fetchone()
            latest_old = conn.execute(IDENTITY_SQL, ('off-a', 'dep-a', 'rev-old', methodology)).fetchone()
            missing = conn.execute(IDENTITY_SQL, ('off-a', 'dep-a', 'rev-missing', methodology)).fetchone()
            self.assertEqual(latest_new[0], 'run-newer-same')
            self.assertEqual(latest_new[1], 0.91)
            self.assertEqual(latest_new[2], 'rev-new')
            self.assertEqual(latest_old[0], 'run-old')
            self.assertEqual(latest_old[1], 0.11)
            self.assertIsNone(missing)
            components = conn.execute(COMPONENTS_SQL, ([latest_new[0]],)).fetchall()
            self.assertTrue(components)
            self.assertTrue(all(row[0] == 'run-newer-same' for row in components))
            mismatched = conn.execute(
                IDENTITY_SQL, ('off-b', 'dep-a', 'rev-new', methodology)
            ).fetchone()
            self.assertIsNone(mismatched)
            conn.rollback()
