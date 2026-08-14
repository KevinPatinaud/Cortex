import { NotFoundError } from "../../../application/error/NotFoundError.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";

interface ErrorResponse {
  error: string;
}

export interface ErrorMappingOptions {
  fallbackStatus: number;
  fallbackMessage: string;
  logMessage: string;
  exposeUnexpectedError?: boolean;
  toFallbackBody?: (message: string) => unknown;
}

export interface MappedHttpError {
  status: number;
  body: unknown;
  shouldLog: boolean;
}

export function toHttpError(
  error: unknown,
  options: ErrorMappingOptions
): MappedHttpError {
  if (error instanceof ValidationError) {
    return toExpectedError(400, error.message);
  }

  if (error instanceof NotFoundError) {
    return toExpectedError(404, error.message);
  }

  if (isExpressBodyError(error, "entity.parse.failed", 400)) {
    return toExpectedError(400, "The JSON request body is invalid.");
  }

  if (isExpressBodyError(error, "entity.too.large", 413)) {
    return toExpectedError(413, "The request body exceeds the allowed size.");
  }

  const message = options.exposeUnexpectedError && error instanceof Error
    ? error.message
    : options.fallbackMessage;

  return {
    status: options.fallbackStatus,
    body: options.toFallbackBody?.(message) ?? { error: message },
    shouldLog: true
  };
}

function isExpressBodyError(
  error: unknown,
  type: string,
  status: number
): boolean {
  return typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === type &&
    "status" in error &&
    error.status === status;
}

function toExpectedError(status: number, message: string): MappedHttpError {
  const body: ErrorResponse = { error: message };

  return {
    status,
    body,
    shouldLog: false
  };
}
