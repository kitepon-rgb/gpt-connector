export const connectorErrorCodes = [
  "AUTH_REQUIRED",
  "CDP_UNAVAILABLE",
  "RUNTIME_DRIFT",
  "MODEL_NOT_AVAILABLE",
  "EFFORT_NOT_SUPPORTED",
  "CHAT_FAILED",
  "STREAM_INCOMPLETE",
  "SESSION_NOT_FOUND",
  "SESSION_BUSY",
  "ARCHIVE_FAILED",
] as const;

export type ConnectorErrorCode = (typeof connectorErrorCodes)[number];

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    details?: Readonly<Record<string, string | number | boolean | null>>,
  ) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.details = details;
  }
}
