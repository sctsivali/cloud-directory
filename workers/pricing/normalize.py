"""Price normalization with Decimal. No implicit currency fallback."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

SUPPORTED_CURRENCIES = frozenset(
    {
        "USD",
        "SGD",
        "MYR",
        "IDR",
        "THB",
        "VND",
        "PHP",
        "BND",
        "KHR",
        "LAK",
        "MMK",
    }
)
BILLING_UNITS = frozenset({"hour", "day", "month", "year"})
COMMITMENTS = frozenset({"none", "month", "year"})
RENEWALS = frozenset({"same_as_list", "intro_then_list", "unknown"})
TAX_STATES = frozenset({"inclusive", "exclusive", "unknown"})


class PriceNormalizationError(ValueError):
    """Price failed closed. No IDR or other fallback is applied."""


@dataclass(frozen=True)
class NormalizedPrice:
    amount: Decimal
    currency: str
    billing_unit: str
    commitment: str
    promo: bool
    renewal: str
    tax: str
    region: str
    source: str
    fx_date: date | None
    fx_rate: Decimal | None
    fx_quote_currency: str | None


def _decimal(value: object, field: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise PriceNormalizationError(f"{field} is required")
    if isinstance(value, float):
        raise PriceNormalizationError(f"{field} must not be a binary float")
    if isinstance(value, Decimal):
        amount = value
    elif isinstance(value, int):
        amount = Decimal(value)
    elif isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text:
            raise PriceNormalizationError(f"{field} is required")
        try:
            amount = Decimal(text)
        except InvalidOperation as exc:
            raise PriceNormalizationError(f"{field} is not a decimal") from exc
    else:
        raise PriceNormalizationError(f"{field} is not a decimal")
    if amount <= 0:
        raise PriceNormalizationError(f"{field} must be positive")
    return amount


def _required_token(value: object, field: str, allowed: frozenset[str] | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PriceNormalizationError(f"{field} is required")
    token = value.strip()
    if allowed is not None and token not in allowed:
        raise PriceNormalizationError(f"{field} is unsupported: {token}")
    return token


def _parse_fx_date(value: object) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        raise PriceNormalizationError("fx_date is required when an FX rate is supplied")
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as exc:
        raise PriceNormalizationError("fx_date is malformed") from exc


def normalize_price(
    *,
    amount: object,
    currency: object,
    billing_unit: object,
    commitment: object,
    promo: object,
    renewal: object,
    tax: object,
    region: object,
    source: object,
    fx_date: object = None,
    fx_rate: object = None,
    fx_quote_currency: object = None,
) -> NormalizedPrice:
    if currency is None or (isinstance(currency, str) and not currency.strip()):
        raise PriceNormalizationError("currency is required; no fallback currency is applied")
    if not isinstance(currency, str):
        raise PriceNormalizationError("currency is required; no fallback currency is applied")
    code = currency.strip().upper()
    if code not in SUPPORTED_CURRENCIES:
        raise PriceNormalizationError(f"unsupported currency: {code}")

    if not isinstance(promo, bool):
        raise PriceNormalizationError("promo must be a boolean")

    rate: Decimal | None = None
    quote: str | None = None
    observed_fx: date | None = None
    if fx_rate is not None or fx_quote_currency is not None:
        if fx_date is None:
            raise PriceNormalizationError("fx_date is required when an FX rate is supplied")
        observed_fx = _parse_fx_date(fx_date)
        rate = _decimal(fx_rate, "fx_rate")
        quote = _required_token(fx_quote_currency, "fx_quote_currency", SUPPORTED_CURRENCIES)
    elif fx_date is not None:
        observed_fx = _parse_fx_date(fx_date)

    return NormalizedPrice(
        amount=_decimal(amount, "amount"),
        currency=code,
        billing_unit=_required_token(billing_unit, "billing_unit", BILLING_UNITS),
        commitment=_required_token(commitment, "commitment", COMMITMENTS),
        promo=promo,
        renewal=_required_token(renewal, "renewal", RENEWALS),
        tax=_required_token(tax, "tax", TAX_STATES),
        region=_required_token(region, "region"),
        source=_required_token(source, "source"),
        fx_date=observed_fx,
        fx_rate=rate,
        fx_quote_currency=quote,
    )
