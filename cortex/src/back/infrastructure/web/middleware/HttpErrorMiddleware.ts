import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response
} from "express";
import {
  toHttpError,
  type ErrorMappingOptions
} from "../mapper/HttpErrorMapper.ts";

type AsyncRouteHandler<RequestBody> = (
  request: Request<Record<string, never>, unknown, RequestBody>,
  response: Response
) => Promise<void>;

class HttpRouteError {
  constructor(
    readonly cause: unknown,
    readonly mapping: ErrorMappingOptions
  ) {}
}

const defaultErrorMapping: ErrorMappingOptions = {
  fallbackStatus: 500,
  fallbackMessage: "Une erreur interne est survenue.",
  logMessage: "Erreur HTTP non geree :"
};

export function asyncRoute<RequestBody = unknown>(
  handler: AsyncRouteHandler<RequestBody>,
  errorMapping: ErrorMappingOptions
): RequestHandler<Record<string, never>, unknown, RequestBody> {
  return (request, response, next: NextFunction) => {
    void handler(request, response).catch((error: unknown) => {
      next(new HttpRouteError(error, errorMapping));
    });
  };
}

export const httpErrorMiddleware: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const routeError = error instanceof HttpRouteError
    ? error
    : new HttpRouteError(error, defaultErrorMapping);
  const mappedError = toHttpError(routeError.cause, routeError.mapping);

  if (mappedError.shouldLog) {
    console.error(routeError.mapping.logMessage, routeError.cause);
  }

  response.status(mappedError.status).json(mappedError.body);
};
