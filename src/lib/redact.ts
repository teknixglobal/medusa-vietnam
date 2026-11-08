const SECRET_KEYS = /secret|signature|hash|password|token|authorization|x-secret-key/i

/** Copy of an object with secret-looking keys masked, for logging. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.test(key) ? "***" : redact(v, depth + 1)
  }
  return out
}
