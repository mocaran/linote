import { env } from "cloudflare:workers";
import { encryptApiKey } from "../../../lib/account-secret";
import { sameOrigin, sessionUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

async function account(request: Request) {
  const user = await sessionUser(request);
  return user && env.DB ? { userId: user.userId, db: env.DB } : null;
}

export async function GET(request: Request) {
  const user = await account(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const row = await user.db.prepare("SELECT 1 AS present FROM account_secrets WHERE user_id=?").bind(user.userId).first();
  return Response.json({ hasKey: Boolean(row) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const user = await account(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "请求无效" }, { status: 400 }); }
  const key = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!key || key.length > 300) return Response.json({ error: "请输入有效的 DeepSeek API 密钥" }, { status: 400 });
  if (input.ifMissing) {
    const row = await user.db.prepare("SELECT 1 AS present FROM account_secrets WHERE user_id=?").bind(user.userId).first();
    if (row) return Response.json({ hasKey: true, imported: false });
  }
  let encrypted: { ciphertext: string; iv: string };
  try { encrypted = await encryptApiKey(key); }
  catch { return Response.json({ error: "密钥存储尚未配置" }, { status: 503 }); }
  await user.db.prepare("INSERT INTO account_secrets (user_id,deepseek_key_ciphertext,deepseek_key_iv,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET deepseek_key_ciphertext=excluded.deepseek_key_ciphertext,deepseek_key_iv=excluded.deepseek_key_iv,updated_at=excluded.updated_at")
    .bind(user.userId, encrypted.ciphertext, encrypted.iv, new Date().toISOString()).run();
  return Response.json({ hasKey: true, imported: true });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const user = await account(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  await user.db.prepare("DELETE FROM account_secrets WHERE user_id=?").bind(user.userId).run();
  return Response.json({ hasKey: false });
}
