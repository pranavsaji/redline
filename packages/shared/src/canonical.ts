/**
 * Deterministic JSON: object keys sorted, no whitespace. Used for everything that is hashed or signed.
 * Rejects values JSON cannot represent faithfully (undefined, functions, symbols, bigint, non-finite numbers).
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, '$');
}

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => serialise(v, `${path}[${i}]`)).join(',')}]`;
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const entries = Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${serialise((value as Record<string, unknown>)[k], `${path}.${k}`)}`);
      return `{${entries.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}
