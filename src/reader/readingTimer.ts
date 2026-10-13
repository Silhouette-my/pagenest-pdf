/*
 * Counts active reading time. Time accrues only while a document is open, the
 * tab is visible and the reader has interacted (scroll, pointer, keys) within
 * the idle window — so a tab left open overnight does not count.
 */
import { addReadingTime, localDateKey } from "../history/readingHistory";

const TICK_MS = 5_000;
const IDLE_LIMIT_MS = 3 * 60_000;
const FLUSH_MS = 30_000;
/** A tick never credits more than this (sleep, throttled timers…). */
const MAX_TICK_CREDIT_MS = 15_000;

interface ActiveDocument {
  id: string;
  name: string;
}

export class ReadingTimer {
  #document: ActiveDocument | null = null;
  #lastActivity = 0;
  #lastTick = 0;
  #pending = new Map<string, { date: string; documentId: string; name: string; ms: number }>();
  #tickTimer: number | null = null;
  #flushTimer: number | null = null;

  constructor(
    activityRoot: HTMLElement,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    const touch = (): void => {
      this.#lastActivity = performance.now();
    };
    for (const type of ["pointermove", "pointerdown", "wheel", "keydown"] as const) {
      window.addEventListener(type, touch, { passive: true, capture: true });
    }
    activityRoot.addEventListener("scroll", touch, { passive: true });
    document.addEventListener("selectionchange", touch);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.#tick();
        void this.flush();
      } else {
        // Coming back counts as activity, but the hidden gap never does.
        this.#lastTick = performance.now();
        touch();
      }
    });
    window.addEventListener("pagehide", () => {
      this.#tick();
      void this.flush();
    });
    document.addEventListener("freeze", () => {
      this.#tick();
      void this.flush();
    });

    this.#tickTimer = window.setInterval(() => this.#tick(), TICK_MS);
    this.#flushTimer = window.setInterval(() => void this.flush(), FLUSH_MS);
  }

  /** Start (or switch) the document being timed; null stops timing. */
  setDocument(document: ActiveDocument | null): void {
    this.#tick();
    this.#document = document;
    this.#lastTick = performance.now();
    this.#lastActivity = performance.now();
    void this.flush();
  }

  async flush(): Promise<void> {
    const entries = [...this.#pending.values()]
      .map((entry) => ({ ...entry, seconds: Math.floor(entry.ms / 1000) }))
      .filter((entry) => entry.seconds > 0);
    if (!entries.length) return;

    // Keep sub-second remainders for the next flush.
    for (const entry of entries) {
      const key = `${entry.date}|${entry.documentId}`;
      const pending = this.#pending.get(key);
      if (pending) pending.ms -= entry.seconds * 1000;
    }

    try {
      await addReadingTime(entries);
    } catch (error) {
      // Put the time back so it is retried on the next flush.
      for (const entry of entries) {
        const key = `${entry.date}|${entry.documentId}`;
        const pending = this.#pending.get(key);
        if (pending) pending.ms += entry.seconds * 1000;
      }
      this.onError(error);
    }
  }

  dispose(): void {
    if (this.#tickTimer !== null) window.clearInterval(this.#tickTimer);
    if (this.#flushTimer !== null) window.clearInterval(this.#flushTimer);
  }

  #tick(): void {
    const now = performance.now();
    const elapsed = now - this.#lastTick;
    this.#lastTick = now;
    const doc = this.#document;

    if (!doc || document.hidden || elapsed <= 0) return;
    if (now - this.#lastActivity > IDLE_LIMIT_MS) return;

    const credit = Math.min(elapsed, MAX_TICK_CREDIT_MS);
    const date = localDateKey();
    const key = `${date}|${doc.id}`;
    const pending = this.#pending.get(key);
    if (pending) pending.ms += credit;
    else this.#pending.set(key, { date, documentId: doc.id, name: doc.name, ms: credit });
  }
}
