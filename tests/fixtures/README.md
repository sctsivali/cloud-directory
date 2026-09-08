# Phase 0 acceptance corpus

Immutable, sanitized comparison evidence for the legacy directory. These files are not a production extract and are not the expected behavior of the future scoring engine.

- Provider JSON is fictional. Names, URLs, halls, and prices are invented.
- Source HTML is synthetic. It must not be fetched live.
- `legacy-scores.json` and `legacy-shortlists.json` record what the current functions emit.
- `known_defects` entries always set `blessed: false`.

Required coverage is listed in `MANIFEST.json`. Do not silently edit captured scores to hide a defect; add a defect record instead.
