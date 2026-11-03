export function accountIdFromRequest(request: Request): string | null {
  const encoded = request.headers.get("x-linote-account");
  if (!encoded) return null;
  let value: string;
  try { value = decodeURIComponent(encoded).trim().normalize("NFC"); }
  catch { return null; }
  if (!value || Array.from(value).length > 32 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  return `id:${value}`;
}
