const safeStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // SSR / sandboxed — fall through
  }
  return null;
};

const memory = new Map<string, string>();

export const storageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const s = safeStorage();
    if (s) return s.getItem(key);
    return memory.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    const s = safeStorage();
    if (s) {
      s.setItem(key, value);
      return;
    }
    memory.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    const s = safeStorage();
    if (s) {
      s.removeItem(key);
      return;
    }
    memory.delete(key);
  },
};
