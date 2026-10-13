export type CanvasRenderPriority = "high" | "normal" | "low";

interface QueueItem<T> {
  priority: number;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
  task(): Promise<T>;
  detachAbort(): void;
}

const queue: Array<QueueItem<unknown>> = [];
let running = false;

function priorityValue(priority: CanvasRenderPriority): number {
  return priority === "high" ? 0 : priority === "normal" ? 1 : 2;
}

function scheduleNext(): void {
  if (running || queue.length === 0) return;
  queue.sort((a, b) => a.priority - b.priority);
  const item = queue.shift();
  if (!item) return;
  item.detachAbort();
  running = true;
  // Rendering stays exclusive: perceptual theme hooks are global.
  void Promise.resolve()
    .then(item.task)
    .then(item.resolve, item.reject)
    .finally(() => {
      running = false;
      scheduleNext();
    });
}

export function runCanvasRenderExclusive<T>(
  task: () => Promise<T>,
  priority: CanvasRenderPriority = "normal",
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abortError = () => new DOMException("Queued rendering cancelled.", "AbortError");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      const index = queue.indexOf(item);
      if (index < 0) return; // An active render owns its cancellation/settlement.
      queue.splice(index, 1);
      item.detachAbort();
      reject(abortError());
    };
    const item: QueueItem<unknown> = {
      priority: priorityValue(priority),
      resolve: resolve as QueueItem<unknown>["resolve"],
      reject,
      task,
      detachAbort: () => signal?.removeEventListener("abort", onAbort),
    };
    queue.push(item);
    signal?.addEventListener("abort", onAbort, { once: true });
    scheduleNext();
  });
}
