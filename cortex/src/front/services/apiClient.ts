interface ApiErrorBody {
  error?: unknown;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: Fetcher = fetch
): Promise<T> {
  let response: Response;

  try {
    response = await fetcher(input, init);
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error && error.message
        ? `Server unreachable: ${error.message}`
        : "Server unreachable.",
      null
    );
  }

  const body = await readResponseBody(response);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("cortex:unauthorized"));
    }

    throw new ApiRequestError(
      getApiErrorMessage(body) ||
        `The request failed (HTTP ${response.status}).`,
      response.status
    );
  }

  if (body === undefined) {
    throw new ApiRequestError(
      "The server returned an empty response.",
      response.status
    );
  }

  return body as T;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) {
      return undefined;
    }

    throw new ApiRequestError(
      "The server returned an invalid response.",
      response.status
    );
  }
}

function getApiErrorMessage(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ApiErrorBody).error === "string"
  ) {
    return (body as ApiErrorBody).error as string;
  }

  return null;
}
