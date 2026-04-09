export class EventBus {
  private listeners = new Map<string, Set<(event: any) => void>>();

  on(channel: string, listener: (event: any) => void): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);

    return () => {
      this.listeners.get(channel)?.delete(listener);
    };
  }

  emit(channel: string, event: any): void {
    this.listeners.get(channel)?.forEach((listener) => {
      listener(event);
    });
  }
}

export const globalBus = new EventBus();
