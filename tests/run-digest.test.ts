import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDigest } from "../src/index";
import { logger } from "../src/utils/logger";
import { config, fetchMock, todoistSnapshot } from "./fixtures";

let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "taskovo-run-test-"));
  setSystemTime(new Date("2026-10-25T12:00:00Z"));
});

afterEach(async () => {
  mock.restore();
  setSystemTime();
  await rm(stateDir, { recursive: true });
});

test("weather failure does not block sends; a recipient failure does not block later recipients or safe reruns", async () => {
  let failOwner = true;
  const sends: string[] = [];
  fetchMock(async (input, options) => {
    const url = String(input);
    if (url.includes("geocoding-api")) throw new TypeError("Example geocoding failure");
    if (url.endsWith("/sync")) return Response.json(todoistSnapshot());
    if (url.endsWith("/location_reminders")) return Response.json({ results: [] });
    if (url === "https://api.resend.com/emails") {
      const to = JSON.parse(String(options?.body)).to[0];
      sends.push(to);
      return failOwner && to === "owner@example.com"
        ? new Response("", { status: 401 })
        : Response.json({ id: "example-email-id" });
    }
    throw new Error("Unexpected test request");
  });
  const info = spyOn(logger, "info");
  const settings = config({ stateDir, weatherLocation: "Example city" });
  await expect(runDigest(false, settings)).rejects.toBeInstanceOf(AggregateError);
  expect(sends).toEqual(["owner@example.com", "collaborator@example.com"]);
  expect(info).toHaveBeenCalledWith(
    "Digest run completed",
    expect.objectContaining({ sent: 1, failed: 1, skipped: 0 }),
  );
  failOwner = false;
  await runDigest(false, settings);
  expect(sends).toEqual(["owner@example.com", "collaborator@example.com", "owner@example.com"]);
  expect(info).toHaveBeenCalledWith(
    "Digest run completed",
    expect.objectContaining({ sent: 1, failed: 0, skipped: 1 }),
  );
});

test("dry runs use the same seven-day AI window and do not create delivery state or send mail", async () => {
  const snapshot = todoistSnapshot();
  const original = snapshot.items[0]!;
  snapshot.items = [
    { ...original, content: "Today example", due: { ...original.due, date: "2026-10-25" } },
    { ...original, content: "Last day example", due: { ...original.due, date: "2026-10-31" } },
    { ...original, content: "Outside example", due: { ...original.due, date: "2026-11-01" } },
  ];
  let summaries = 0;
  fetchMock(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/sync")) return Response.json(snapshot);
    if (url.endsWith("/location_reminders")) return Response.json({ results: [] });
    if (url === "https://llm.example.com/v1/chat/completions") {
      const prompt = JSON.parse(String(options?.body)).messages[1].content;
      expect(prompt).toContain("Today example");
      expect(prompt).toContain("Last day example");
      expect(prompt).not.toContain("Outside example");
      summaries++;
      return Response.json({ choices: [{ message: { content: "Example summary" }, finish_reason: "stop" }] });
    }
    throw new Error("Unexpected test request");
  });
  spyOn(console, "log").mockImplementation(() => {});
  await runDigest(true, config({ stateDir, llmBaseUrl: "https://llm.example.com" }));
  expect(summaries).toBe(2);
  expect(await readdir(stateDir)).toEqual([]);
});
