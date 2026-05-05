import { Observable } from "rxjs";
import type { EventBusPort, FeedbackEvent, SubscribeOptions } from "@llm-feedback-middleware/core";

/**
 * Wrap a topic subscription on an EventBusPort as an RxJS Observable.
 *
 * Subscribers that need operators (debounce, buffer, groupBy, windowTime,
 * mergeMap, throttleTime, distinctUntilChanged, etc.) can pipe the result.
 * Subscribers that don't never import this package and never pull in RxJS.
 *
 * The Observable's teardown invokes the bus's unsubscribe so cleanup is
 * automatic.
 */
export function toStream(
  bus: EventBusPort,
  topic: string | string[],
  options?: SubscribeOptions,
): Observable<{ event: FeedbackEvent; topic: string }> {
  return new Observable<{ event: FeedbackEvent; topic: string }>((subscriber) => {
    const unsubscribe = bus.subscribe(
      topic,
      async (event, deliveredTopic) => {
        subscriber.next({ event, topic: deliveredTopic });
      },
      options,
    );
    return () => {
      // Best-effort teardown; await is not allowed here.
      void unsubscribe();
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
    const unsubscribe = bus.subscribe(
      topic,
      async (event) => {
        subscriber.next(event);
      },
      options,
    );
    return () => {
      void unsubscribe();
    };
  });
}
