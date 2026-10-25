import { afterEach, expect, spyOn, test } from "bun:test";
import { fetchWithRetry, HttpError } from "../src/utils/http";
import { fetchMock as mockRequests } from "./fixtures";

afterEach(() => {
  mockFetch.mockRestore();
});

let mockFetch = spyOn(globalThis, "fetch");

test("retries network errors and transient HTTP errors with a fresh timeout", async () => {
  mockFetch = spyOn(globalThis, "fetch");
  mockFetch.mockRejectedValueOnce(new TypeError("Example network failure"));
  mockFetch.mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "0" } }));
  mockFetch.mockResolvedValueOnce(Response.json({ ok: true }));
  const response = await fetchWithRetry("https://example.com", {}, "Example");
  expect(await response.json()).toEqual({ ok: true });
  expect(mockFetch).toHaveBeenCalledTimes(3);
  const signals = mockFetch.mock.calls.map(([, options]) => options?.signal);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(new Set(signals).size).toBe(3);
});

test("does not retry authentication failures or excessive Retry-After delays", async () => {
  mockFetch = spyOn(globalThis, "fetch");
  mockFetch.mockResolvedValueOnce(new Response("", { status: 401 }));
  await expect(fetchWithRetry("https://example.com", {}, "Example")).rejects.toBeInstanceOf(HttpError);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  mockFetch.mockClear();
  mockFetch.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "120" } }));
  await expect(fetchWithRetry("https://example.com", {}, "Example")).rejects.toThrow("429");
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test("timeouts are bounded to three attempts", async () => {
  mockFetch = spyOn(globalThis, "fetch");
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() =>
    AbortSignal.abort(new DOMException("Example timeout", "TimeoutError")),
  );
  mockFetch = mockRequests(async (_input, options) => {
    options?.signal?.throwIfAborted();
    throw new Error("Expected an aborted signal");
  });
  try {
    await expect(fetchWithRetry("https://example.com", {}, "Example")).rejects.toThrow("after 3 attempts");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls).toEqual([[15000], [15000], [15000]]);
  } finally {
    timeout.mockRestore();
  }
});
