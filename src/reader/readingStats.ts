/*
 * Reading statistics: stat tiles, a single-series bar chart (last 14 days or
 * last 12 weeks) and a per-document breakdown that doubles as the table view.
 */
import type { ReadingTimeRecord } from "../history/readingHistory";
import { localDateKey } from "../history/readingHistory";
import { getLocale, t } from "../i18n/i18n";

type StatsMode = "day" | "week";

const DAY_BARS = 14;
const WEEK_BARS = 12;

interface Bucket {
  key: string;
  start: Date;
  end: Date; // exclusive
  seconds: number;
}

export interface ReadingStatsOptions {
  onOpenDocument(documentId: string): void;
  canOpenDocument(documentId: string): boolean;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return totalSeconds <= 0 ? t("{m} min", { m: 0 }) : t("<1 min");
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? t("{h} h {m} min", { h: hours, m: minutes }) : t("{m} min", { m: minutes });
}

function parseDateKey(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Weeks start on Monday. */
function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function niceCeiling(seconds: number): number {
  const steps = [5, 10, 15, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720].map((m) => m * 60);
  return steps.find((step) => step >= seconds) ?? Math.ceil(seconds / 3600) * 3600;
}

function axisLabel(seconds: number): string {
  if (seconds === 0) return "0";
  return seconds % 3600 === 0
    ? t("{h}h", { h: seconds / 3600 })
    : t("{m}m", { m: Math.round(seconds / 60) });
}

export class ReadingStatsView {
  #records: ReadingTimeRecord[] = [];
  #mode: StatsMode = "day";
  #selected: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ReadingStatsOptions,
  ) {}

  setRecords(records: ReadingTimeRecord[]): void {
    this.#records = records;
    this.#selected = null;
    this.render();
  }

  render(): void {
    const locale = getLocale();
    const today = parseDateKey(localDateKey());
    const buckets = this.#buckets(today);
    const range = { start: buckets[0]!.start, end: buckets.at(-1)!.end };
    const selected = buckets.find((bucket) => bucket.key === this.#selected) ?? null;

    this.root.replaceChildren(
      this.#modeControl(),
      this.#tiles(buckets, today),
      this.#chart(buckets, locale),
      this.#documents(selected ?? range, selected, locale),
    );
  }

  // ---- data -------------------------------------------------------------

  #secondsBetween(start: Date, end: Date): number {
    const from = localDateKey(start);
    const to = localDateKey(end);
    return this.#records.reduce(
      (sum, record) => (record.date >= from && record.date < to ? sum + record.seconds : sum),
      0,
    );
  }

  #buckets(today: Date): Bucket[] {
    const buckets: Bucket[] = [];

    if (this.#mode === "day") {
      for (let index = DAY_BARS - 1; index >= 0; index -= 1) {
        const start = addDays(today, -index);
        const end = addDays(start, 1);
        buckets.push({ key: localDateKey(start), start, end, seconds: 0 });
      }
    } else {
      const thisWeek = startOfWeek(today);
      for (let index = WEEK_BARS - 1; index >= 0; index -= 1) {
        const start = addDays(thisWeek, -7 * index);
        const end = addDays(start, 7);
        buckets.push({ key: localDateKey(start), start, end, seconds: 0 });
      }
    }

    for (const bucket of buckets) {
      bucket.seconds = this.#secondsBetween(bucket.start, bucket.end);
    }
    return buckets;
  }

  // ---- pieces -------------------------------------------------------------

  #modeControl(): HTMLElement {
    const control = document.createElement("div");
    control.className = "stats-segmented";
    control.setAttribute("role", "tablist");

    for (const [mode, label] of [
      ["day", t("Daily")],
      ["week", t("Weekly")],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(this.#mode === mode));
      button.textContent = label;
      button.addEventListener("click", () => {
        if (this.#mode === mode) return;
        this.#mode = mode;
        this.#selected = null;
        this.render();
      });
      control.append(button);
    }
    return control;
  }

  #tiles(buckets: Bucket[], today: Date): HTMLElement {
    const tiles = document.createElement("div");
    tiles.className = "stats-tiles";
    const items: Array<[string, number]> = [];

    if (this.#mode === "day") {
      const lastSeven = this.#secondsBetween(addDays(today, -6), addDays(today, 1));
      items.push(
        [t("Today"), buckets.at(-1)!.seconds],
        [t("Last 7 Days"), lastSeven],
        [t("Daily Average"), Math.round(lastSeven / 7)],
      );
    } else {
      const total = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
      items.push(
        [t("This Week"), buckets.at(-1)!.seconds],
        [t("Last Week"), buckets.at(-2)!.seconds],
        [t("Weekly Average"), Math.round(total / buckets.length)],
      );
    }

    for (const [label, seconds] of items) {
      const tile = document.createElement("div");
      tile.className = "stats-tile";
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("strong");
      value.textContent = formatDuration(seconds);
      tile.append(name, value);
      tiles.append(tile);
    }
    return tiles;
  }

  #bucketLabel(bucket: Bucket, locale: string, long: boolean): string {
    const date = bucket.start;
    if (this.#mode === "week") {
      const format = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
      return long
        ? t("Week of {date}", { date: format.format(date) })
        : format.format(date);
    }
    if (long) {
      return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        weekday: "short",
      }).format(date);
    }
    return date.getDate() === 1
      ? new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date)
      : String(date.getDate());
  }

  #chart(buckets: Bucket[], locale: string): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "stats-chart";

    const max = niceCeiling(Math.max(...buckets.map((bucket) => bucket.seconds), 60));
    const grid = document.createElement("div");
    grid.className = "stats-grid";
    grid.setAttribute("aria-hidden", "true");
    for (const fraction of [1, 0.5, 0]) {
      const line = document.createElement("div");
      line.className = "stats-gridline";
      line.style.bottom = `${fraction * 100}%`;
      const label = document.createElement("span");
      label.textContent = axisLabel(max * fraction);
      line.append(label);
      grid.append(line);
    }

    const bars = document.createElement("div");
    bars.className = "stats-bars";
    bars.dataset.mode = this.#mode;

    const tooltip = document.createElement("div");
    tooltip.className = "stats-tooltip";
    tooltip.hidden = true;

    buckets.forEach((bucket, index) => {
      const column = document.createElement("button");
      column.type = "button";
      column.className = "stats-column";
      const longLabel = this.#bucketLabel(bucket, locale, true);
      const value = formatDuration(bucket.seconds);
      column.setAttribute("aria-label", `${longLabel}: ${value}`);
      column.setAttribute("aria-pressed", String(this.#selected === bucket.key));
      if (index === buckets.length - 1) column.dataset.current = "true";

      const bar = document.createElement("span");
      bar.className = "stats-bar";
      bar.style.height = bucket.seconds > 0
        ? `max(3px, ${(bucket.seconds / max) * 100}%)`
        : "0";
      column.append(bar);

      const label = document.createElement("span");
      label.className = "stats-axis-label";
      // Label every other bar, aligned so the current day/week is labelled.
      const showLabel = (buckets.length - 1 - index) % 2 === 0;
      label.textContent = showLabel
        ? index === buckets.length - 1
          ? this.#mode === "day" ? t("Today") : t("This Week")
          : this.#bucketLabel(bucket, locale, false)
        : "";
      column.append(label);

      const show = (): void => {
        tooltip.replaceChildren();
        const title = document.createElement("span");
        title.textContent = longLabel;
        const amount = document.createElement("strong");
        amount.textContent = value;
        tooltip.append(title, amount);
        tooltip.hidden = false;
        const columnRect = column.getBoundingClientRect();
        const figureRect = figure.getBoundingClientRect();
        const left = columnRect.left + columnRect.width / 2 - figureRect.left;
        tooltip.style.left = `${left}px`;
      };
      column.addEventListener("pointerenter", show);
      column.addEventListener("focus", show);
      column.addEventListener("pointerleave", () => (tooltip.hidden = true));
      column.addEventListener("blur", () => (tooltip.hidden = true));
      column.addEventListener("click", () => {
        this.#selected = this.#selected === bucket.key ? null : bucket.key;
        this.render();
      });
      bars.append(column);
    });

    const plot = document.createElement("div");
    plot.className = "stats-plot";
    plot.append(grid, bars, tooltip);

    const caption = document.createElement("figcaption");
    caption.textContent =
      this.#mode === "day"
        ? t("Reading time, last 14 days · click a bar to filter documents")
        : t("Reading time, last 12 weeks · click a bar to filter documents");
    figure.append(plot, caption);
    return figure;
  }

  #documents(
    range: { start: Date; end: Date },
    selected: Bucket | null,
    locale: string,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = "stats-documents";

    const header = document.createElement("div");
    header.className = "stats-documents-header";
    const title = document.createElement("h3");
    title.textContent = selected
      ? t("Documents · {range}", { range: this.#bucketLabel(selected, locale, true) })
      : this.#mode === "day"
        ? t("Documents · last 14 days")
        : t("Documents · last 12 weeks");
    header.append(title);

    if (selected) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "stats-link";
      clear.textContent = t("Show All");
      clear.addEventListener("click", () => {
        this.#selected = null;
        this.render();
      });
      header.append(clear);
    }
    section.append(header);

    const from = localDateKey(range.start);
    const to = localDateKey(range.end);
    const perDocument = new Map<string, { name: string; seconds: number; last: string }>();
    for (const record of this.#records) {
      if (record.date < from || record.date >= to) continue;
      const entry = perDocument.get(record.documentId) ?? { name: record.name, seconds: 0, last: record.date };
      entry.seconds += record.seconds;
      if (record.date >= entry.last) {
        entry.last = record.date;
        if (record.name) entry.name = record.name;
      }
      perDocument.set(record.documentId, entry);
    }

    const rows = [...perDocument.entries()]
      .filter(([, entry]) => entry.seconds >= 1)
      .sort((a, b) => b[1].seconds - a[1].seconds);

    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "stats-empty";
      empty.textContent = this.#records.length
        ? t("No reading recorded in this period.")
        : t("No reading time recorded yet. Time is counted while you actively read a document.");
      section.append(empty);
      return section;
    }

    const top = rows[0]![1].seconds;
    const list = document.createElement("ol");
    list.className = "stats-document-list";
    const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });

    for (const [documentId, entry] of rows) {
      const item = document.createElement("li");
      const openable = this.options.canOpenDocument(documentId);
      const row = document.createElement(openable ? "button" : "div");
      row.className = "stats-document";
      if (row instanceof HTMLButtonElement) {
        row.type = "button";
        row.title = t("Open {name}", { name: entry.name });
        row.addEventListener("click", () => this.options.onOpenDocument(documentId));
      }

      const name = document.createElement("span");
      name.className = "stats-document-name";
      name.textContent = entry.name || t("Untitled");
      const time = document.createElement("span");
      time.className = "stats-document-time";
      time.textContent = formatDuration(entry.seconds);
      const meter = document.createElement("span");
      meter.className = "stats-meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.max(2, (entry.seconds / top) * 100)}%`;
      meter.append(fill);
      const last = document.createElement("span");
      last.className = "stats-document-last";
      last.textContent = t("Last read {date}", { date: dateFormat.format(parseDateKey(entry.last)) });

      row.append(name, time, meter, last);
      item.append(row);
      list.append(item);
    }

    const total = rows.reduce((sum, [, entry]) => sum + entry.seconds, 0);
    const totalLine = document.createElement("p");
    totalLine.className = "stats-total";
    totalLine.textContent = t("{count} documents · {time} in total", {
      count: rows.length,
      time: formatDuration(total),
    });

    section.append(list, totalLine);
    return section;
  }
}
