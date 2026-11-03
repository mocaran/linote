import { env } from "cloudflare:workers";

const COOKIE = "linote_session";
const SESSION_DAYS = 30;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().normalize("NFC");
  return value && Array.from(value).length <= 32 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
}

export function validPassword(raw: unknown): raw is string {
  return typeof raw === "string";
}

function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join(""); }
function fromHex(value: string): Uint8Array { return new Uint8Array(value.match(/.{2}/g)?.map(x => parseInt(x,16)) || []); }

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:Uint8Array.from(fromHex(saltHex)),iterations:100000}, key, 256);
  return hex(new Uint8Array(bits));
}

export function newSalt(): string { return hex(crypto.getRandomValues(new Uint8Array(16))); }

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const actual = fromHex(await hashPassword(password,salt));
  const target = fromHex(expected);
  if (actual.length !== target.length) return false;
  let difference = 0;
  for (let i=0; i<actual.length; i++) difference |= actual[i] ^ target[i];
  return difference === 0;
}

async function tokenHash(token: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))); }
function cookieToken(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)linote_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || null;
}

export async function sessionUser(request: Request): Promise<{username:string;userId:string}|null> {
  const token = cookieToken(request);
  if (!token || !env.DB) return null;
  const hash = await tokenHash(token);
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(hash,new Date().toISOString()).first<{user_id:string}>();
  if (!row?.user_id.startsWith("id:")) return null;
  return {username:row.user_id.slice(3),userId:row.user_id};
}

export async function createSession(request: Request, userId: string): Promise<string> {
  if (!env.DB) throw new Error("Database unavailable");
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await tokenHash(token);
  const now = new Date();
  const expires = new Date(now.getTime()+SESSION_DAYS*86400000);
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(hash,userId,expires.toISOString(),now.toISOString()).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS*86400}${secure}`;
}

export async function clearSession(request: Request): Promise<string> {
  const token = cookieToken(request);
  if (token && env.DB) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
