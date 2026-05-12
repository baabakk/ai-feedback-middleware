import { Observable } from "rxjs";
import type {
  EventBusPort,
  FeedbackEvent,
  SubscribeOptions,
  Unsubscribe,
} from "@ai-feedback-middleware/core";

/**
 * Wrap a topic subscription on an EventBusPort as an RxJS Observable.
 *
 * Subscribers that need operators (debounce, buffer, groupBy, windowTime,
 * mergeMap, throttleTime, distinctUntilChanged, etc.) can pipe the result.
 * Subscribers that don't never import this package and never pull in RxJS.
 *
 * The Observable's teardown invokes the bus's unsubscribe so cleanup is
 * automatic. The Observable handles the async subscribe() round-trip
 * internally — emitted values arrive once the broker confirms registration.
 */
export function toStream(
  bus: EventBusPort,
  topic: string | string[],
  options?: SubscribeOptions,
): Observable<{ event: FeedbackEvent; topic: string }> {
  return new Observable<{ event: FeedbackEvent; topic: string }>((subscriber) => {
    let unsub: Unsubscribe | null = null;
    let cancelled = false;
    void bus
      .subscribe(
        topic,
        async (event, deliveredTopic) => {
          subscriber.next({ event, topic: deliveredTopic });
        },
        options,
      )
      .then((u) => {
        if (cancelled) {
          void u();
          return;
        }
        unsub = u;
      })
      .catch((err) => subscriber.error(err));
    return () => {
      cancelled = true;
      if (unsub) void unsub();
    };
  });
}

/**
 * Same as `toStream` but yields just the event (drops the topic). For
 * subscribers that don't need to know which topic delivered.
 */
export function toEventStream(
  bus: EventBusPort,
  topic: string | string[],
  options?: SubscribeOptions,
): Observable<FeedbackEvent> {
  return new Observable<FeedbackEvent>((subscriber) => {
    let unsub: Unsubscribe | null = null;
    let cancelled = false;
    void bus
      .subscribe(
        topic,
        async (event) => {
          subscriber.next(event);
        },
        options,
      )
      .then((u) => {
        if (cancelled) {
          void u();
          return;
        }
        unsub = u;
      })
      .catch((err) => subscriber.error(err));
    return () => {
      cancelled = true;
      if (unsub) void unsub();
    };
  });
}
