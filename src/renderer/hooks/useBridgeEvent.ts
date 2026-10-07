import { useEffect, useRef } from 'react';
import type { Unsubscribe } from '../types';

/**
 * Subscribes to a main-process event for the component's lifetime.
 * `subscribe` is a `bar.onX` function (returns an unsubscribe). The latest
 * `handler` is always used, so handlers may close over fresh state without
 * re-subscribing.
 */
export function useBridgeEvent<T>(subscribe: (cb: (payload: T) => void) => Unsubscribe, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => subscribe((payload) => handlerRef.current(payload)), [subscribe]);
}
