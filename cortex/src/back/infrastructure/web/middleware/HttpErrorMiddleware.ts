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

type AsyncRouteHandler<RequestBody, RouteParams> = (
  request: Request<RouteParams, unknown, RequestBody>,
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
  fallbackMessage: "An internal error occurred.",
  logMessage: "Unhandled HTTP error:"
};

export function asyncRoute<
  RequestBody = unknown,
  RouteParams = Record<string, never>
>(
  handler: AsyncRouteHandler<RequestBody, RouteParams>,
  errorMapping: ErrorMappingOptions
): RequestHandler<RouteParams, unknown, RequestBody> {
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
