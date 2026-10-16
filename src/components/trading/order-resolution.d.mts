type OrderResolution = "pending" | "unknown";

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StorageProvider = () => StoragePort;

export function readOrderResolution(getStorage: StorageProvider, key: string | null): string | null;
export function writeOrderResolution(getStorage: StorageProvider, key: string | null, value: OrderResolution): void;
export function clearOrderResolution(getStorage: StorageProvider, key: string | null): void;