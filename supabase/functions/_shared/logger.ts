export function newRequestId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}
