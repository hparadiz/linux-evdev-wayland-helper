export class NdjsonParser<T> {
  private buffer = "";

  push(chunk: string | Uint8Array): T[] {
    this.buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const events: T[] = [];

    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        return events;
      }

      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }
      events.push(JSON.parse(line) as T);
    }
  }
}
