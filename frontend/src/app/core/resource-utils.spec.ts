import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { refreshResource, safeResourceValue } from './resource-utils';

/** A resource whose value() throws while it has none, like Angular 22's ResourceValueError. */
function fakeResource<T>() {
  const value = signal<T | undefined>(undefined);
  return {
    value: value,
    resource: {
      hasValue: () => value() !== undefined,
      value: (): T => {
        const current = value();
        if (current === undefined) throw new Error('ResourceValueError');
        return current;
      },
    },
  };
}

describe('safeResourceValue', () => {
  it('returns the fallback instead of throwing while the resource has no value', () => {
    const { resource } = fakeResource<string[]>();
    const safe = safeResourceValue(resource, []);

    expect(() => resource.value()).toThrow();
    expect(safe()).toEqual([]);
  });

  it('follows the resource once a value arrives and falls back again when it is lost', () => {
    const { value, resource } = fakeResource<string[]>();
    const safe = safeResourceValue(resource, ['fallback']);

    value.set(['a', 'b']);
    expect(safe()).toEqual(['a', 'b']);

    value.set(undefined);
    expect(safe()).toEqual(['fallback']);
  });
});

describe('refreshResource', () => {
  it('does not bump the tick when reload() accepted the refresh', () => {
    const tick = signal(0);
    refreshResource({ reload: () => true }, tick);
    expect(tick()).toBe(0);
  });

  it('bumps the tick when reload() declined because a load is in flight', () => {
    const tick = signal(3);
    refreshResource({ reload: () => false }, tick);
    refreshResource({ reload: () => false }, tick);
    expect(tick()).toBe(5);
  });
});
