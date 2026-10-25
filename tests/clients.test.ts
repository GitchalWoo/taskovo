import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fetchTodoistData } from "../src/todoist/client";
import { fetchWeekForecast } from "../src/weather/client";
import { fetchF1Schedule } from "../src/f1/client";
import { fetchLocalEvents } from "../src/events/client";
import { config, fetchMock, todoistSnapshot } from "./fixtures";

afterEach(() => mock.restore());

test("every Todoist run requests a complete snapshot without using cursor state", async () => {
  const requests = fetchMock(async (input, options) => {
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    if (String(input).endsWith("/location_reminders")) return Response.json({ results: [] });
    expect(JSON.parse(String(options?.body)).sync_token).toBe("*");
    return Response.json(todoistSnapshot());
  });
  const first = await fetchTodoistData(config());
  const second = await fetchTodoistData(config());
  expect(second).toEqual(first);
  expect(second.tasks).toHaveLength(1);
  expect(second.collaborators).toHaveLength(2);
  expect(second.ownerId).toBe("owner");
  expect(requests).toHaveBeenCalledTimes(4);
});

test.each(["network", "timeout", "invalid-json", "http-error"])(
  "weather geocoding %s failure stays optional",
  async (failure) => {
    fetchMock(async () => {
      if (failure === "network") throw new TypeError("Example network failure");
      if (failure === "timeout") throw new DOMException("Example timeout", "TimeoutError");
      if (failure === "http-error") return new Response("", { status: 503 });
      return new Response("{");
    });
    await expect(fetchWeekForecast(config({ weatherLocation: "Example city" }))).resolves.toBeNull();
  },
);

test("forecast requests the shared window in the configured timezone", async () => {
  const requests = fetchMock(async (input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("timezone")).toBe("Europe/Warsaw");
    expect(url.searchParams.get("start_date")).toBe("2026-10-25");
    expect(url.searchParams.get("end_date")).toBe("2026-10-31");
    return Response.json({
      daily: {
        time: ["2026-10-25"],
        temperature_2m_max: [10.2],
        temperature_2m_min: [2.3],
        weather_code: [0],
      },
    });
  });
  const forecast = await fetchWeekForecast(config({ weatherLatitude: "52", weatherLongitude: "21" }), {
    start: "2026-10-25",
    end: "2026-10-31",
  });
  expect(forecast?.days[0]?.tempMax).toBe(10);
  expect(requests).toHaveBeenCalledTimes(1);
});

test("F1 uses local session dates, not UTC date boundaries", async () => {
  const race = (date: string, name: string) => ({
    round: "1",
    raceName: name,
    date,
    time: "23:30:00Z",
    Circuit: {
      circuitName: "Example circuit",
      Location: { locality: "Example city", country: "Example country" },
    },
  });
  spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      MRData: {
        RaceTable: {
          season: "2026",
          Races: [race("2026-10-24", "Included race"), race("2026-10-31", "Excluded race")],
        },
      },
    }),
  );
  const result = await fetchF1Schedule(config({ f1Schedule: true, timezone: "Asia/Tokyo" }), {
    start: "2026-10-25",
    end: "2026-10-31",
  });
  expect(result?.events.map((event) => event.raceName)).toEqual(["Included race"]);
});

test("local events query and filtering share the digest's seven calendar dates", async () => {
  const box = (name: string, date: string) =>
    `<div class="box"><div class="box-title"><a title="${name}" href="wydarzenie-example">Example</a></div><div class="box-data">${date}</div></div>`;
  fetchMock(async (input) => {
    expect(new URL(String(input)).searchParams.get("wydarzenia")).toBe("25.10.2026");
    return new Response(box("Included event", "31.10.2026") + box("Excluded event", "01.11.2026"));
  });
  const result = await fetchLocalEvents(config({ eventsEnabled: true }), {
    start: "2026-10-25",
    end: "2026-10-31",
  });
  expect(result?.events.map((event) => event.title)).toEqual(["Included event"]);
});
