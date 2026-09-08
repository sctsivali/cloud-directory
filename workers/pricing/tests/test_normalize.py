"""Price normalization: Decimal, explicit currency, no IDR fallback."""
from __future__ import annotations

import unittest
from decimal import Decimal

from workers.pricing.normalize import PriceNormalizationError, normalize_price


class TestNormalizePrice(unittest.TestCase):
    def test_monthly_usd_list_price(self):
        price = normalize_price(
            amount="8.50",
            currency="USD",
            billing_unit="month",
            commitment="none",
            promo=False,
            renewal="same_as_list",
            tax="unknown",
            region="ID",
            source="https://fixtures.example.test/page",
        )
        self.assertEqual(price.amount, Decimal("8.50"))
        self.assertIsInstance(price.amount, Decimal)
        self.assertEqual(price.currency, "USD")
        self.assertEqual(price.billing_unit, "month")
        self.assertFalse(price.promo)

    def test_annual_commitment_is_distinct(self):
        price = normalize_price(
            amount="96",
            currency="USD",
            billing_unit="year",
            commitment="year",
            promo=False,
            renewal="same_as_list",
            tax="exclusive",
            region="MY",
            source="https://fixtures.example.test/stale",
        )
        self.assertEqual(price.billing_unit, "year")
        self.assertEqual(price.commitment, "year")

    def test_promo_flag_is_explicit(self):
        price = normalize_price(
            amount="3.99",
            currency="USD",
            billing_unit="month",
            commitment="none",
            promo=True,
            renewal="intro_then_list",
            tax="unknown",
            region="VN",
            source="https://fixtures.example.test/promo",
        )
        self.assertTrue(price.promo)
        self.assertEqual(price.renewal, "intro_then_list")

    def test_missing_currency_does_not_fall_back_to_idr(self):
        with self.assertRaises(PriceNormalizationError) as ctx:
            normalize_price(
                amount="10000",
                currency=None,
                billing_unit="month",
                commitment="none",
                promo=False,
                renewal="unknown",
                tax="unknown",
                region="ID",
                source="https://fixtures.example.test/page",
            )
        self.assertIn("no fallback", str(ctx.exception).lower())

    def test_unsupported_currency_fails(self):
        with self.assertRaises(PriceNormalizationError):
            normalize_price(
                amount="10",
                currency="XYZ",
                billing_unit="month",
                commitment="none",
                promo=False,
                renewal="unknown",
                tax="unknown",
                region="PH",
                source="https://fixtures.example.test/page",
            )

    def test_float_amount_fails_closed(self):
        with self.assertRaises(PriceNormalizationError):
            normalize_price(
                amount=8.5,
                currency="USD",
                billing_unit="month",
                commitment="none",
                promo=False,
                renewal="unknown",
                tax="unknown",
                region="ID",
                source="https://fixtures.example.test/page",
            )

    def test_fx_rate_requires_fx_date(self):
        with self.assertRaises(PriceNormalizationError):
            normalize_price(
                amount="16000",
                currency="IDR",
                billing_unit="month",
                commitment="none",
                promo=False,
                renewal="unknown",
                tax="unknown",
                region="ID",
                source="https://fixtures.example.test/page",
                fx_rate="16000",
                fx_quote_currency="USD",
            )

    def test_fx_observation_is_recorded_when_complete(self):
        price = normalize_price(
            amount="16000",
            currency="IDR",
            billing_unit="month",
            commitment="none",
            promo=False,
            renewal="unknown",
            tax="unknown",
            region="ID",
            source="https://fixtures.example.test/page",
            fx_date="2026-09-01",
            fx_rate="16000",
            fx_quote_currency="USD",
        )
        self.assertEqual(str(price.fx_date), "2026-09-01")
        self.assertEqual(price.fx_rate, Decimal("16000"))
        self.assertEqual(price.currency, "IDR")

    def test_billing_unit_is_required(self):
        with self.assertRaises(PriceNormalizationError):
            normalize_price(
                amount="10",
                currency="USD",
                billing_unit="",
                commitment="none",
                promo=False,
                renewal="unknown",
                tax="unknown",
                region="ID",
                source="https://fixtures.example.test/page",
            )
