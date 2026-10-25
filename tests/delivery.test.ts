import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sendDigestEmail } from "../src/email/sender";
import { config, fetchMock as mockRequests } from "./fixtures";

let stateDir: string;
const digest = { subject: "Example subject", text: "Example text", html: "<p>Example text</p>" };
const window = { start: "2026-10-25", end: "2026-10-31" };

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "taskovo-delivery-test-"));
});

afterEach(async () => {
  mock.restore();
  await rm(stateDir, { recursive: true });
});

test("successful deliveries persist across reruns and changed content, but not new periods", async () => {
  const fetchMock = mockRequests(async (_input, options) => {
    expect(new Headers(options?.headers).get("idempotency-key")).toMatch(/^digest\/[a-f0-9]{64}$/);
    return Response.json({ id: "example-email-id" });
  });
  expect(await sendDigestEmail(config({ stateDir }), digest, "OWNER@example.com", window)).toBe("sent");
  expect(
    await sendDigestEmail(
      config({ stateDir }),
      { ...digest, text: "Changed content" },
      "owner@example.com",
      window,
    ),
  ).toBe("skipped");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    await sendDigestEmail(config({ stateDir }), digest, "owner@example.com", {
      start: "2026-11-01",
      end: "2026-11-07",
    }),
  ).toBe("sent");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const directory = path.join(stateDir, "deliveries");
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  for (const file of await readdir(directory)) {
    expect(file).toMatch(/^[a-f0-9]{64}\.json$/);
    expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
  }
});

test("a retry after uncertain confirmation reuses the exact original body and key", async () => {
  const fetchMock = mockRequests(async () => new Response("{"));
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow();
  const original = fetchMock.mock.calls[0]![1]!;
  const firstRetryCall = fetchMock.mock.calls.length;
  fetchMock.mockResolvedValue(Response.json({ id: "example-email-id" }));
  expect(
    await sendDigestEmail(
      config({ stateDir }),
      { ...digest, subject: "Changed subject" },
      "owner@example.com",
      window,
    ),
  ).toBe("sent");
  const retry = fetchMock.mock.calls[firstRetryCall]![1]!;
  expect(retry.body).toBe(original.body);
  expect(new Headers(retry.headers).get("idempotency-key")).toBe(
    new Headers(original.headers).get("idempotency-key"),
  );
});

test("transient sends reuse their idempotency key and payload", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
    .mockResolvedValueOnce(Response.json({ id: "example-email-id" }));
  await sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0]![1]?.body).toBe(fetchMock.mock.calls[1]![1]?.body);
  expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("idempotency-key")).toBe(
    new Headers(fetchMock.mock.calls[1]![1]?.headers).get("idempotency-key"),
  );
});

test("SDK transport timeouts retry with fresh signals and the same idempotency key", async () => {
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() =>
    AbortSignal.abort(new DOMException("Example timeout", "TimeoutError")),
  );
  const requests = mockRequests(async (_input, options) => {
    options?.signal?.throwIfAborted();
    throw new Error("Expected an aborted signal");
  });
  try {
    await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
      "after 3 attempts",
    );
    expect(requests).toHaveBeenCalledTimes(3);
    expect(timeout.mock.calls).toEqual([[15000], [15000], [15000]]);
    const signals = requests.mock.calls.map(([, options]) => options?.signal);
    expect(new Set(signals).size).toBe(3);
    const keys = requests.mock.calls.map(([, options]) =>
      new Headers(options?.headers).get("idempotency-key"),
    );
    expect(new Set(keys).size).toBe(1);
  } finally {
    timeout.mockRestore();
  }
});

test.each([400, 401, 409])("SDK HTTP %s errors fail without retrying", async (statusCode) => {
  const requests = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { name: "validation_error", statusCode, message: "Example API error" },
      { status: statusCode },
    ),
  );
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    String(statusCode),
  );
  expect(requests).toHaveBeenCalledTimes(1);
});

test("SDK Retry-After metadata prevents excessive waits", async () => {
  const requests = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { name: "rate_limit_exceeded", statusCode: 429, message: "Example rate limit" },
      { status: 429, headers: { "retry-after": "120" } },
    ),
  );
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "429",
  );
  expect(requests).toHaveBeenCalledTimes(1);
});

test("SDK server errors stop after three attempts", async () => {
  const requests = mockRequests(async () =>
    Response.json(
      { name: "internal_server_error", statusCode: 503, message: "Example server failure" },
      { status: 503 },
    ),
  );
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "503",
  );
  expect(requests).toHaveBeenCalledTimes(3);
});

test("invalid SDK success data never marks a pending delivery as sent", async () => {
  const requests = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "invalid delivery confirmation",
  );
  expect(requests).toHaveBeenCalledTimes(1);
  const directory = path.join(stateDir, "deliveries");
  const [filename] = await readdir(directory);
  const state = JSON.parse(await readFile(path.join(directory, filename!), "utf8"));
  expect(state.sent).toBe(false);
});

test("stale uncertain deliveries require reconciliation instead of risking a duplicate", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "401",
  );
  const directory = path.join(stateDir, "deliveries");
  const [filename] = await readdir(directory);
  const file = path.join(directory, filename!);
  const state = JSON.parse(await readFile(file, "utf8"));
  state.createdAt = Date.now() - 24 * 60 * 60 * 1000;
  await writeFile(file, JSON.stringify(state));
  fetchMock.mockClear();
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "too old to retry safely",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("pending snapshots cannot be resent after recipient project membership changes", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
  await expect(
    sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window, '["project-1"]'),
  ).rejects.toThrow("401");
  fetchMock.mockClear();
  await expect(
    sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window, '["project-2"]'),
  ).rejects.toThrow("Project membership changed");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("confirmed deliveries stay skipped beyond Resend's key retention", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "example-email-id" }));
  await sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window);
  const directory = path.join(stateDir, "deliveries");
  const [filename] = await readdir(directory);
  const file = path.join(directory, filename!);
  const state = JSON.parse(await readFile(file, "utf8"));
  state.createdAt = Date.now() - 48 * 60 * 60 * 1000;
  await writeFile(file, JSON.stringify(state));
  fetchMock.mockClear();
  expect(await sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).toBe("skipped");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("corrupt state and unwritable state are explicit errors, not duplicate sends", async () => {
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "example-email-id" }));
  await sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window);
  const directory = path.join(stateDir, "deliveries");
  const [filename] = await readdir(directory);
  await writeFile(path.join(directory, filename!), "{}");
  fetchMock.mockClear();
  await expect(sendDigestEmail(config({ stateDir }), digest, "owner@example.com", window)).rejects.toThrow(
    "Invalid delivery state",
  );
  const blockingFile = path.join(stateDir, "not-a-directory");
  await writeFile(blockingFile, "");
  await expect(
    sendDigestEmail(config({ stateDir: blockingFile }), digest, "owner@example.com", window),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
