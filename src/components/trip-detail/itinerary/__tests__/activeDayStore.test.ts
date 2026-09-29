import { describe, expect, it, jest } from '@jest/globals';
import { createActiveDayStore } from '../useDayNavigation';

describe('createActiveDayStore', () => {
  it('notifies only on real changes', () => {
    const store = createActiveDayStore();
    const listener = jest.fn();
    const off = store.subscribe(listener);
    store.set(2);
    store.set(2);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.set(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
