import { Signal, WritableSignal, computed } from '@angular/core';

/** The slice of Angular's `Resource` the helpers below need. */
interface ReadableResource<T> {
  hasValue(): boolean;
  value(): T;
}

/**
 * Error-safe view of a resource's value.
 *
 * In Angular 22, reading `resource.value()` THROWS (`ResourceValueError`) while
 * the resource is in the error state — `defaultValue` does not prevent it. A raw
 * `.value` exposed from a store therefore turns one failed request into an
 * exception in every template/computed that reads it, which blanks the whole
 * view. This returns `fallback` instead whenever there is no usable value; pair
 * it with the store's own `errorMessage` to render the failure.
 */
export function safeResourceValue<T>(resource: ReadableResource<T>, fallback: T): Signal<T> {
  return computed(() => (resource.hasValue() ? resource.value() : fallback));
}

/**
 * Forces a refetch that is never silently dropped.
 *
 * `resource.reload()` is a no-op (returns false) while a load is already in
 * flight, so a change that lands mid-load (a second SSE event, a retry click)
 * would be lost. When `reload()` declines, bump `tick` instead: the store reads
 * `tick` inside its request function, so the changed request restarts the load.
 */
export function refreshResource(
  resource: { reload(): boolean },
  tick: WritableSignal<number>,
): void {
  if (!resource.reload()) {
    tick.update((n) => n + 1);
  }
}
