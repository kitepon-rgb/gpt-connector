const secretKeyPattern = /authorization|cookie|token|attestation|conduit|account.?id/i;
const longIdentifierPattern = /\b[A-Za-z0-9_-]{32,}\b/g;

export function redactDiagnostic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnostic);

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        secretKeyPattern.test(key) ? "[redacted]" : redactDiagnostic(child),
      ]),
    );
  }

  if (typeof value === "string") {
    return value.replace(longIdentifierPattern, "[redacted]");
  }

  return value;
}
