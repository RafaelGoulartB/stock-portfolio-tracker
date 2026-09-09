import type { AssetClass, Currency } from "@portifolio-tracker/shared";

export const SPOT_OPEN_TTL_MS = 15 * 60 * 1_000;
const MAX_CLOSED_TTL_MS = 3 * 24 * 60 * 60 * 1_000;

type Session = "b3" | "us" | "crypto" | "none";

type SessionHours = {
  timeZone: string;
  openMinutes: number;
  closeMinutes: number;
};

const SESSIONS: Record<Exclude<Session, "none" | "crypto">, SessionHours> = {
  b3: {
    timeZone: "America/Sao_Paulo",
    openMinutes: 10 * 60,
    closeMinutes: 18 * 60,
  },
  us: {
    timeZone: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
  },
};

function sessionFor(assetClass: AssetClass, currency: Currency): Session {
  if (assetClass === "crypto") {
    return "crypto";
  }

  if (
    assetClass === "fixed_income" ||
    assetClass === "other" ||
    assetClass === "cash"
  ) {
    return "none";
  }

  if (
    assetClass === "stock_us" ||
    ((assetClass === "etf" || assetClass === "reit") && currency === "USD")
  ) {
    return "us";
  }

  return "b3";
}

function zonedClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  return {
    weekday: value("weekday") ?? "",
    year: Number(value("year") ?? 0),
    month: Number(value("month") ?? 0),
    day: Number(value("day") ?? 0),
    minutes: Number(value("hour") ?? 0) * 60 + Number(value("minute") ?? 0),
  };
}

function isWeekday(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

function sessionIsOpen(session: SessionHours, now: Date): boolean {
  const clock = zonedClock(now, session.timeZone);

  return (
    isWeekday(clock.weekday) &&
    clock.minutes >= session.openMinutes &&
    clock.minutes < session.closeMinutes
  );
}

/** Minutes until the next regular-session open, ignoring exchange holidays. */
function minutesUntilOpen(session: SessionHours, now: Date): number {
  const clock = zonedClock(now, session.timeZone);

  if (isWeekday(clock.weekday) && clock.minutes < session.openMinutes) {
    return (
      (zonedSessionOpen(session, clock.year, clock.month, clock.day).getTime() -
        now.getTime()) /
      60_000
    );
  }

  const nextDay = new Date(
    Date.UTC(clock.year, clock.month - 1, clock.day + 1),
  );
  while (nextDay.getUTCDay() === 0 || nextDay.getUTCDay() === 6) {
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  }

  return (
    (zonedSessionOpen(
      session,
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
    ).getTime() -
      now.getTime()) /
    60_000
  );
}

/** Resolves a local session opening time to its absolute instant. */
function zonedSessionOpen(
  session: SessionHours,
  year: number,
  month: number,
  day: number,
): Date {
  const hour = Math.floor(session.openMinutes / 60);
  const minute = session.openMinutes % 60;
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallTime;

  // Two passes resolve the timezone offset on both sides of DST boundaries.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: session.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const representedWallTime = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    instant += wallTime - representedWallTime;
  }

  return new Date(instant);
}

/**
 * How long a delayed spot quote stays authoritative. Crypto trades through
 * the weekend; listed stocks freeze after the cash session, so the TTL
 * stretches until the next open instead of refetching a dead tape.
 */
export function spotTtlMs(
  assetClass: AssetClass,
  currency: Currency,
  now = new Date(),
): number {
  const session = sessionFor(assetClass, currency);

  if (session === "crypto") {
    return SPOT_OPEN_TTL_MS;
  }

  if (session === "none") {
    return SPOT_OPEN_TTL_MS;
  }

  const hours = SESSIONS[session];

  if (sessionIsOpen(hours, now)) {
    return SPOT_OPEN_TTL_MS;
  }

  return Math.min(minutesUntilOpen(hours, now) * 60 * 1_000, MAX_CLOSED_TTL_MS);
}

/** Extra window a stale quote may be served while a refresh is in flight. */
export function spotStaleWhileRevalidateMs(
  assetClass: AssetClass,
  currency: Currency,
  now = new Date(),
): number {
  return spotTtlMs(assetClass, currency, now);
}
