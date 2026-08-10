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

  const message = options.exposeUnexpectedError && error instanceof Error
    ? error.message
    : options.fallbackMessage;

  return {
    status: options.fallbackStatus,
    body: options.toFallbackBody?.(message) ?? { error: message },
    shouldLog: true
  };
}

function toExpectedError(status: number, message: string): MappedHttpError {
  const body: ErrorResponse = { error: message };

  return {
    status,
    body,
    shouldLog: false
  };
}
