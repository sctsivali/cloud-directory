export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export function ok(): ValidationResult {
  return { ok: true };
}

export function fail(...errors: string[]): ValidationResult {
  const trimmed = errors.filter((e) => e.length > 0);
  return { ok: false, errors: trimmed.length ? trimmed : ["invalid"] };
}

export function requireNonEmpty(value: string | null | undefined, field: string): string | null {
  if (value == null || value.trim() === "") {
    return `${field} is required`;
  }
  return null;
}

export function temporalBoundsOk(validFrom: string | null, validTo: string | null): boolean {
  if (validFrom == null || validTo == null) {
    return true;
  }
  return validTo >= validFrom;
}
