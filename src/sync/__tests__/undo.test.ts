/**
 * Undo stack (S2.5) — pure-core tests: LIFO ordering, capacity eviction,
 * empty behavior, subscription notifications. The product flows (place
 * remove, reorder, AI-apply) compose mutation-layer UndoEntries on top of
 * exactly these semantics.
 */
import { DEFAULT_UNDO_CAPACITY, UndoStack, type UndoEntry } from '../undo';

function entry(label: string, log: string[]): UndoEntry {
  return { label, inverse: () => void log.push(label) };
}

describe('UndoStack — LIFO ordering', () => {
  it('undoes the most recent entry first', async () => {
    const log: string[] = [];
    const stack = new UndoStack();
    stack.push(entry('first', log));
    stack.push(entry('second', log));

    const undone = await stack.undoLast();
    expect(undone?.label).toBe('second');
    expect(log).toEqual(['second']);

    await stack.undoLast();
    expect(log).toEqual(['second', 'first']);
    expect(stack.canUndo).toBe(false);
  });

  it('peekLabel mirrors what undoLast() would run', async () => {
    const stack = new UndoStack();
    expect(stack.peekLabel).toBeNull();
    stack.push(entry('a', []));
    stack.push(entry('b', []));
    expect(stack.peekLabel).toBe('b');
    await stack.undoLast();
    expect(stack.peekLabel).toBe('a');
  });

  it('undoLast on an empty stack resolves null without throwing', async () => {
    await expect(new UndoStack().undoLast()).resolves.toBeNull();
  });
});

describe('UndoStack — capacity eviction', () => {
  it('evicts the OLDEST entry beyond capacity', async () => {
    const log: string[] = [];
    const stack = new UndoStack(3);
    for (const l of ['one', 'two', 'three', 'four']) stack.push(entry(l, log));
    expect(stack.size).toBe(3);

    while (stack.canUndo) await stack.undoLast();
    // 'one' was evicted — only the newest three ran, newest-first.
    expect(log).toEqual(['four', 'three', 'two']);
  });

  it('default capacity is the documented 20', () => {
    const stack = new UndoStack();
    for (let i = 0; i < 25; i++) stack.push(entry(`e${i}`, []));
    expect(stack.size).toBe(DEFAULT_UNDO_CAPACITY);
  });

  it('rejects nonsense capacities', () => {
    expect(() => new UndoStack(0)).toThrow();
    expect(() => new UndoStack(2.5)).toThrow();
  });
});

describe('UndoStack — async inverses and subscriptions', () => {
  it('awaits async inverse ops', async () => {
    const order: string[] = [];
    const stack = new UndoStack();
    stack.push({
      label: 'async',
      inverse: async () => {
        await Promise.resolve();
        order.push('inverse-done');
      },
    });
    await stack.undoLast();
    order.push('after-await');
    expect(order).toEqual(['inverse-done', 'after-await']);
  });

  it('notifies subscribers on push, undo, and clear — and unsubscribe works', async () => {
    const stack = new UndoStack();
    let notifications = 0;
    const unsubscribe = stack.subscribe(() => void notifications++);

    stack.push(entry('a', []));
    await stack.undoLast();
    stack.push(entry('b', []));
    stack.clear();
    expect(notifications).toBe(4);

    unsubscribe();
    stack.push(entry('c', []));
    expect(notifications).toBe(4);
  });

  it('a throwing inverse propagates and is NOT re-pushed (documented semantics)', async () => {
    const stack = new UndoStack();
    stack.push({
      label: 'boom',
      inverse: () => {
        throw new Error('inverse failed');
      },
    });
    await expect(stack.undoLast()).rejects.toThrow('inverse failed');
    expect(stack.canUndo).toBe(false);
  });
});
