export const connectorErrorCodes = [
  "INVALID_INPUT",
  "AUTH_REQUIRED",
  "CDP_UNAVAILABLE",
  "RUNTIME_DRIFT",
  "MODEL_NOT_AVAILABLE",
  "EFFORT_NOT_SUPPORTED",
  "FILE_NOT_FOUND",
  "FILE_OUTSIDE_ROOT",
  "SENSITIVE_FILE_BLOCKED",
  "FILE_TYPE_NOT_SUPPORTED",
  "FILE_EMPTY",
  "FILE_LIMIT_EXCEEDED",
  "UPLOAD_FAILED",
  "UPLOAD_TIMEOUT",
  "ATTACHMENT_READBACK_FAILED",
  "CHAT_FAILED",
  "STREAM_INCOMPLETE",
  "SESSION_NOT_FOUND",
  "SESSION_BUSY",
  "ARCHIVE_FAILED",
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
  "JOB_RECOVERY_UNAVAILABLE",
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
