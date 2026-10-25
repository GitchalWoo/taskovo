import { setTimeout as sleep } from "node:timers/promises";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    service: string,
    public readonly retryAfter: string | null = null,
  ) {
    super(`${service} API error: ${status}`);
  }
}

export class TransportError extends Error {}

export async function withRequestRetry<T>(
  request: (signal: AbortSignal) => Promise<T>,
  service: string,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(AbortSignal.timeout(15_000));
    } catch (error) {
      const httpError = error instanceof HttpError ? error : null;
      const retryable = httpError
        ? httpError.status === 429 || httpError.status >= 500
        : error instanceof TransportError;
      if (!retryable) throw error;
      if (attempt === 2) {
        if (httpError) throw error;
        throw new Error(`${service} request failed after 3 attempts`, { cause: error });
      }
      const retryAfter = httpError?.retryAfter;
      const delay = retryAfter
        ? /^\d+(\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : Math.max(0, Date.parse(retryAfter) - Date.now())
        : 250 * 2 ** attempt;
      if (!Number.isFinite(delay) || delay > 30_000) throw error;
      logger.warn("Retrying failed request", {
        service,
        status: httpError?.status,
        attempt: attempt + 1,
      });
      await sleep(delay);
    }
  }
}

export async function fetchWithRetry(url: string, options: RequestInit, service: string): Promise<Response> {
  return withRequestRetry(async (signal) => {
    let response: Response;
    try {
      response = await fetch(url, { ...options, signal });
    } catch (error) {
      throw new TransportError(`${service} transport failed`, { cause: error });
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      await response.body?.cancel();
      throw new HttpError(response.status, service, retryAfter);
    }
    return response;
  }, service);
}
