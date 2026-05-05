import { describe, it, expect, vi } from "vitest";
import {
  compose,
  retryMiddleware,
  idempotencyMiddleware,
  metricsMiddleware,
  correlationIdMiddleware,
  injectProvenanceMiddleware,
  validationMiddleware,
  loggingMiddleware,
  type DedupeStorePort,
  type MetricsPort,
  type FeedbackEvent,
} from "../src/index.js";

function makeEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    event_id: "e1",
    event_version: 1,
    timestamp: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    partition_key: "p-1",
    source: "explicit",
    polarity: "positive",
    inference: "whitelist",
    action: "approve",
    artifact_type: "draft",
    artifact_id: "p-1",
    artifact_version: 1,
    producer: "test",
    task_type: "test_task",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

describe("compose", () => {
  it("runs middlewares in onion order: outer wraps inner", async () => {
    const trace: string[] = [];
    const wrap =
      (label: string) =>
      (next: (e: FeedbackEvent) => Promise<void>) =>
      async (e: FeedbackEvent) => {
        trace.push(`${label}-pre`);
        await next(e);
        trace.push(`${label}-post`);
      };
    const final = async (_e: FeedbackEvent) => {
      trace.push("final");
    };
    const pipeline = compose<FeedbackEvent>([wrap("a"), wrap("b"), wrap("c")]);
    await pipeline(final)(makeEvent());
    expect(trace).toEqual(["a-pre", "b-pre", "c-pre", "final", "c-post", "b-post", "a-post"]);
  });

  it("empty middleware list passes through to final", async () => {
    let called = false;
    const final = async (_e: FeedbackEvent) => {
      called = true;
    };
    await compose<FeedbackEvent>([])(final)(makeEvent());
    expect(called).toBe(true);
  });
});

describe("retryMiddleware", () => {
  it("retries up to max attempts on failure", async () => {
    let attempts = 0;
    const handler = retryMiddleware({ max: 3, backoff: () => 1 })(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
    });
    await handler(makeEvent());
    expect(attempts).toBe(3);
  });

  it("throws the last error when retries exhausted", async () => {
    const handler = retryMiddleware({ max: 2, backoff: () => 1 })(async () => {
      throw new Error("nope");
    });
    await expect(handler(makeEvent())).rejects.toThrow("nope");
  });

  it("respects retryable predicate (non-retryable throws immediately)", async () => {
    let attempts = 0;
    const handler = retryMiddleware({
      max: 5,
      backoff: () => 1,
      retryable: (err) => err instanceof RangeError,
    })(async () => {
      attempts++;
      throw new TypeError("not retryable");
    });
    await expect(handler(makeEvent())).rejects.toThrow("not retryable");
    expect(attempts).toBe(1);
  });

  it("calls onRetry hook with attempt index", async () => {
    const calls: number[] = [];
    let attempts = 0;
    const handler = retryMiddleware({
      max: 3,
      backoff: () => 1,
      onRetry: (attempt) => calls.push(attempt),
    })(async () => {
      attempts++;
      if (attempts < 3) throw new Error("again");
    });
    await handler(makeEvent());
    expect(calls).toEqual([0, 1]);
  });

  it("succeeds on first try without retry", async () => {
    let attempts = 0;
    const handler = retryMiddleware({ max: 5 })(async () => {
      attempts++;
    });
    await handler(makeEvent());
    expect(attempts).toBe(1);
  });
});

describe("idempotencyMiddleware", () => {
  function makeStore(): DedupeStorePort {
    const seen = new Map<string, number>();
    return {
      async seen(key) {
        const exp = seen.get(key);
        if (exp === undefined) return false;
        if (Date.now() >= exp) {
          seen.delete(key);
          return false;
        }
        return true;
      },
      async mark(key, ttlMs) {
        seen.set(key, Date.now() + ttlMs);
      },
    };
  }

  it("calls handler the first time", async () => {
    const store = makeStore();
    let count = 0;
    const handler = idempotencyMiddleware({ store, subscriberName: "sub-A" })(async () => {
      count++;
    });
    await handler(makeEvent({ event_id: "e1" }));
    expect(count).toBe(1);
  });

  it("skips handler the second time for the same key", async () => {
    const store = makeStore();
    let count = 0;
    const handler = idempotencyMiddleware({ store, subscriberName: "sub-A" })(async () => {
      count++;
    });
    await handler(makeEvent({ event_id: "e1" }));
    await handler(makeEvent({ event_id: "e1" }));
    expect(count).toBe(1);
  });

  it("isolates dedup by subscriberName", async () => {
    const store = makeStore();
    let countA = 0;
    let countB = 0;
    const handlerA = idempotencyMiddleware({ store, subscriberName: "sub-A" })(async () => {
      countA++;
    });
    const handlerB = idempotencyMiddleware({ store, subscriberName: "sub-B" })(async () => {
      countB++;
    });
    await handlerA(makeEvent({ event_id: "e1" }));
    await handlerB(makeEvent({ event_id: "e1" }));
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it("isolates dedup by event_id", async () => {
    const store = makeStore();
    let count = 0;
    const handler = idempotencyMiddleware({ store, subscriberName: "sub" })(async () => {
      count++;
    });
    await handler(makeEvent({ event_id: "e1" }));
    await handler(makeEvent({ event_id: "e2" }));
    expect(count).toBe(2);
  });

  it("does not mark when the inner handler throws (so retries still get through)", async () => {
    const store = makeStore();
    let attempts = 0;
    const handler = idempotencyMiddleware({ store, subscriberName: "sub" })(async () => {
      attempts++;
      if (attempts === 1) throw new Error("first attempt fails");
    });
    await expect(handler(makeEvent({ event_id: "e1" }))).rejects.toThrow();
    await handler(makeEvent({ event_id: "e1" })); // second attempt should succeed
    expect(attempts).toBe(2);
  });
});

describe("metricsMiddleware", () => {
  function makeMetrics(): MetricsPort & {
    counters: Array<{ name: string; labels?: Record<string, string>; value?: number }>;
    timings: Array<{ name: string; ms: number; labels?: Record<string, string> }>;
  } {
    const counters: Array<{ name: string; labels?: Record<string, string>; value?: number }> = [];
    const timings: Array<{ name: string; ms: number; labels?: Record<string, string> }> = [];
    return {
      counters,
      timings,
      increment(name, labels, value) {
        counters.push({ name, labels, value });
      },
      timing(name, ms, labels) {
        timings.push({ name, ms, labels });
      },
    };
  }

  it("emits success counter with action+inference labels on success", async () => {
    const metrics = makeMetrics();
    const handler = metricsMiddleware(metrics)(async () => {});
    await handler(makeEvent({ action: "approve", inference: "whitelist" }));
    expect(metrics.counters.find((c) => c.name === "feedback.pipeline.success")).toBeTruthy();
    expect(metrics.counters[0]!.labels).toEqual({ action: "approve", inference: "whitelist" });
  });

  it("emits error counter with error class label on failure", async () => {
    const metrics = makeMetrics();
    const handler = metricsMiddleware(metrics)(async () => {
      throw new TypeError("boom");
    });
    await expect(handler(makeEvent())).rejects.toThrow();
    const err = metrics.counters.find((c) => c.name === "feedback.pipeline.error");
    expect(err?.labels?.error).toBe("TypeError");
  });

  it("always emits a timing (success and failure)", async () => {
    const metrics = makeMetrics();
    const okHandler = metricsMiddleware(metrics)(async () => {});
    await okHandler(makeEvent());
    expect(metrics.timings.length).toBe(1);

    const failHandler = metricsMiddleware(metrics)(async () => {
      throw new Error("x");
    });
    await expect(failHandler(makeEvent())).rejects.toThrow();
    expect(metrics.timings.length).toBe(2);
  });

  it("respects custom counterPrefix and labels", async () => {
    const metrics = makeMetrics();
    const handler = metricsMiddleware(metrics, {
      counterPrefix: "custom",
      labels: () => ({ env: "prod" }),
    })(async () => {});
    await handler(makeEvent());
    expect(metrics.counters[0]!.name).toBe("custom.success");
    expect(metrics.counters[0]!.labels).toEqual({ env: "prod" });
  });
});

describe("correlationIdMiddleware", () => {
  it("adds correlation_id when missing", async () => {
    let captured: FeedbackEvent | null = null;
    const handler = correlationIdMiddleware(() => "fixed-id")(async (e) => {
      captured = e;
    });
    await handler(makeEvent());
    const prov = captured!.provenance as { correlation_id?: string };
    expect(prov.correlation_id).toBe("fixed-id");
  });

  it("preserves existing correlation_id", async () => {
    let captured: FeedbackEvent | null = null;
    const handler = correlationIdMiddleware(() => "new")(async (e) => {
      captured = e;
    });
    const event = makeEvent({
      provenance: {
        channel: "test",
        captured_by_adapter: "test",
      },
    });
    (event.provenance as { correlation_id?: string }).correlation_id = "existing";
    await handler(event);
    expect((captured!.provenance as { correlation_id?: string }).correlation_id).toBe("existing");
  });
});

describe("injectProvenanceMiddleware", () => {
  it("fills missing channel from defaults", async () => {
    let captured: FeedbackEvent | null = null;
    const handler = injectProvenanceMiddleware({
      channel: "default-channel",
      captured_by_adapter: "default-adapter",
    })(async (e) => {
      captured = e;
    });
    const event = makeEvent({
      provenance: { channel: "", captured_by_adapter: "" },
    });
    await handler(event);
    expect(captured!.provenance.channel).toBe("default-channel");
    expect(captured!.provenance.captured_by_adapter).toBe("default-adapter");
  });

  it("preserves explicit values", async () => {
    let captured: FeedbackEvent | null = null;
    const handler = injectProvenanceMiddleware({
      channel: "default",
    })(async (e) => {
      captured = e;
    });
    await handler(makeEvent({ provenance: { channel: "explicit", captured_by_adapter: "x" } }));
    expect(captured!.provenance.channel).toBe("explicit");
  });
});

describe("validationMiddleware", () => {
  it("passes valid events through", async () => {
    let called = false;
    const handler = validationMiddleware()(async () => {
      called = true;
    });
    await handler(makeEvent());
    expect(called).toBe(true);
  });

  it("throws on schema violation", async () => {
    const handler = validationMiddleware()(async () => {});
    const bad = makeEvent();
    // remove required field
    delete (bad as Record<string, unknown>).action;
    await expect(handler(bad)).rejects.toThrow();
  });
});

describe("loggingMiddleware", () => {
  it("calls log on success and error", async () => {
    const log = vi.fn();
    const ok = loggingMiddleware({ log, pipelineName: "test" })(async () => {});
    await ok(makeEvent());
    expect(log.mock.calls.find((c) => c[0] === "debug" && c[1].includes("ok"))).toBeTruthy();

    log.mockClear();
    const fail = loggingMiddleware({ log, pipelineName: "test" })(async () => {
      throw new Error("boom");
    });
    await expect(fail(makeEvent())).rejects.toThrow();
    expect(log.mock.calls.find((c) => c[0] === "error")).toBeTruthy();
  });
});
