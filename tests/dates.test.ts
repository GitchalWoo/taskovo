import { describe, expect, test } from "bun:test";
import { digestWindow, dueInstant, dueLocalDate, localDate } from "../src/utils/dates";
import { buildDigest } from "../src/digest/builder";
import { createDigestJob } from "../src/index";
import { config, task } from "./fixtures";

describe("timezone-aware digest dates", () => {
  test("uses today plus six days across DST, month, and year boundaries", () => {
    expect(digestWindow("Europe/Warsaw", new Date("2026-10-24T22:30:00Z"))).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
    });
    expect(digestWindow("America/Los_Angeles", new Date("2027-01-01T01:00:00Z"))).toEqual({
      start: "2026-12-31",
      end: "2027-01-06",
    });
    expect(digestWindow("Europe/Warsaw", new Date("2026-03-28T23:30:00Z"))).toEqual({
      start: "2026-03-29",
      end: "2026-04-04",
    });
  });

  test("preserves date-only deadlines and converts timed tasks to the configured date", () => {
    expect(dueLocalDate(task("2026-10-25").due!, "America/Los_Angeles")).toBe("2026-10-25");
    expect(dueLocalDate(task("2026-10-24T23:30:00Z").due!, "Europe/Warsaw")).toBe("2026-10-25");
    expect(localDate(new Date("2026-10-25T23:30:00Z"), "Asia/Tokyo")).toBe("2026-10-26");
  });

  test("resolves floating wall times in the task timezone including DST offsets", () => {
    expect(dueInstant(task("2026-07-01T12:00:00").due!, "Europe/Warsaw").toISOString()).toBe(
      "2026-07-01T10:00:00.000Z",
    );
    expect(dueInstant(task("2026-12-01T12:00:00.123").due!, "Europe/Warsaw").toISOString()).toBe(
      "2026-12-01T11:00:00.123Z",
    );
    const due = { ...task("2026-07-01T12:00:00").due!, timezone: "America/New_York" };
    expect(dueInstant(due, "Europe/Warsaw").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(() => dueInstant(task("2026-03-29T02:30:00").due!, "Europe/Warsaw")).toThrow("does not exist");
  });

  test("renders dates and F1 in TIMEZONE without shifting date-only tasks or weather", () => {
    const window = { start: "2026-10-25", end: "2026-10-31" };
    const tasks = [
      task("2026-10-24", { content: "Overdue example" }),
      task("2026-10-25", { content: "Today example" }),
      task("2026-10-31", { content: "Last day example" }),
      task("2026-11-01", { content: "Outside example" }),
      task("2026-10-25T12:00:00Z", { content: "Timed example" }),
    ];
    const projects = new Map([["project-1", { name: "Example project", order: 0, parentId: null }]]);
    for (const lang of ["en", "pl"]) {
      const digest = buildDigest(
        tasks,
        projects,
        "Asia/Tokyo",
        undefined,
        lang,
        null,
        {
          locationName: null,
          days: [{ date: "2026-10-25", tempMax: 10, tempMin: 2, code: 0, condition: "Clear" }],
        },
        {
          season: "2026",
          events: [
            {
              raceName: "Example race",
              circuitName: "Example circuit",
              locality: "Example city",
              country: "Example country",
              round: 1,
              sessions: [{ name: "Race", date: "2026-10-25", time: "12:00:00Z" }],
            },
          ],
        },
        null,
        window,
      );
      expect(digest.text).toContain("Today example");
      expect(digest.text).toContain("Last day example");
      expect(digest.text).toContain("Overdue example");
      expect(digest.text).not.toContain("Outside example");
      expect(digest.text.match(/21:00/g)).toHaveLength(2);
      expect(digest.html).toContain("21:00");
    }
    const west = buildDigest(
      [task("2026-10-25")],
      projects,
      "America/Los_Angeles",
      undefined,
      "en",
      null,
      null,
      null,
      null,
      window,
    );
    expect(west.text).toContain("Sun, 25 Oct");
  });

  test("cron runs at configured local time across daylight saving", () => {
    const job = createDigestJob(config(), async () => {});
    try {
      expect(job.nextRun(new Date("2026-10-18T12:00:00Z"))?.toISOString()).toBe("2026-10-19T04:00:00.000Z");
      expect(job.nextRun(new Date("2026-10-25T12:00:00Z"))?.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    } finally {
      job.stop();
    }
  });
});
