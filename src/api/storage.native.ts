import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 2000;

function chunkKey(key: string, i: number): string {
  return `${key}__chunk_${i}`;
}

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(`${key}__count`);
  return raw ? parseInt(raw, 10) : 0;
}

export const storageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const count = await getChunkCount(key);
    if (count === 0) return SecureStore.getItemAsync(key);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
      if (chunk === null) return null;
      parts.push(chunk);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.deleteItemAsync(`${key}__count`).catch(() => {});
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(`${key}__count`, String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]!);
    }
  },
  async removeItem(key: string): Promise<void> {
    const count = await getChunkCount(key);
    if (count > 0) {
      await SecureStore.deleteItemAsync(`${key}__count`);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(chunkKey(key, i));
      }
    }
    await SecureStore.deleteItemAsync(key);
  },
};
