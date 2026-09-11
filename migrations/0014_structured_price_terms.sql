-- L5: immutable, stored commercial terms derived from the authoritative receipt.
-- Existing incomplete receipts remain explicitly non-comparable. No guessed terms.
CREATE FUNCTION structured_price_terms(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t jsonb := '{}'::jsonb;
  k text; a text; x jsonb; complete boolean := true;
BEGIN
  FOR k, a IN SELECT * FROM (VALUES
    ('amount','amount'), ('currency','currency'), ('billing_unit','billingUnit'),
    ('commitment_months','commitmentMonths'), ('promo','promo'),
    ('renewal_amount','renewalAmount'), ('tax_state','tax'), ('region','region'),
    ('deployment_id','deploymentId'), ('vcpu','vcpu'), ('ram_gb','ramGb'),
    ('storage_gb','storageGb'), ('storage_type','storageType')) AS keys(k,a)
  LOOP
    x := coalesce(nullif(v->k, 'null'::jsonb), v->a, 'null'::jsonb);
    IF k = 'tax_state' AND x = 'null'::jsonb AND jsonb_typeof(v->'taxIncluded') = 'boolean' THEN
      x := to_jsonb(CASE WHEN v->'taxIncluded' = 'true'::jsonb THEN 'inclusive' ELSE 'exclusive' END);
    END IF;
    t := t || jsonb_build_object(k, x);
    IF k IN ('amount','commitment_months','renewal_amount','vcpu','ram_gb','storage_gb') THEN
      IF jsonb_typeof(x) <> 'number' THEN complete := false;
      ELSE
        IF (x::text)::numeric < 0 THEN complete := false; END IF;
        IF k IN ('amount','vcpu','ram_gb') AND (x::text)::numeric <= 0 THEN complete := false; END IF;
        IF k = 'commitment_months' AND trunc((x::text)::numeric) <> (x::text)::numeric THEN complete := false; END IF;
      END IF;
    ELSIF k = 'promo' THEN
      IF jsonb_typeof(x) <> 'boolean' THEN complete := false; END IF;
    ELSIF jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) = 0 THEN
      complete := false;
    END IF;
  END LOOP;
  RETURN t || jsonb_build_object('comparable', coalesce(complete
    AND v->'comparable' = 'true'::jsonb AND t->'promo' = 'false'::jsonb
    AND t->>'billing_unit' IN ('hour','day','month','year')
    AND t->>'tax_state' IN ('inclusive','exclusive')
    AND t->>'currency' ~ '^[A-Z]{3}$', false));
END;
$$;

CREATE FUNCTION price_basket_fingerprint(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t jsonb := structured_price_terms(v);
  k text; parts text[] := ARRAY[]::text[]; x text;
BEGIN
  IF NOT (structured_price_terms(t || '{"comparable":true,"promo":false}'::jsonb)->>'comparable')::boolean
     OR jsonb_typeof(t->'promo') <> 'boolean' THEN RETURN NULL; END IF;
  FOREACH k IN ARRAY ARRAY['currency','billing_unit','commitment_months','promo','renewal_amount','tax_state','region','deployment_id','vcpu','ram_gb','storage_gb','storage_type'] LOOP
    x := t->>k;
    IF jsonb_typeof(t->k) = 'number' THEN x := trim_scale(x::numeric)::text; END IF;
    parts := array_append(parts, x);
  END LOOP;
  RETURN encode(sha256(convert_to(to_jsonb(parts)::text, 'UTF8')), 'hex');
END;
$$;

ALTER TABLE publication_receipts
  ADD COLUMN price_terms jsonb GENERATED ALWAYS AS (structured_price_terms(after_value)) STORED,
  ADD COLUMN basket_fingerprint text GENERATED ALWAYS AS (price_basket_fingerprint(after_value)) STORED;
COMMENT ON COLUMN publication_receipts.price_terms IS 'Complete structured price contract, including null unknowns; comparable requires explicit true and supported non-promo terms.';
COMMENT ON COLUMN publication_receipts.basket_fingerprint IS 'SHA-256 of ordered comparison attributes excluding observed amount; generated, never caller supplied.';
