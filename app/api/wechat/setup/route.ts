import { env } from "cloudflare:workers";
import { sameOrigin, sessionUser } from "../../../../lib/auth";
import { digestHex, randomHex } from "../../../../lib/wechat";

export const dynamic = "force-dynamic";

async function context(request: Request) {
  const user = await sessionUser(request);
  return user && env.DB ? { db: env.DB, userId: user.userId } : null;
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return Response.json({ error: "请先登录" }, { status: 401 });
  const channel = await ctx.db.prepare("SELECT channel_id,verify_token FROM wechat_channels WHERE user_id=?").bind(ctx.userId).first<{channel_id:string;verify_token:string}>();
  if (!channel) return Response.json({ configured: false }, { headers: { "Cache-Control": "no-store" } });
  const link = await ctx.db.prepare("SELECT 1 AS linked FROM wechat_links WHERE channel_id=? AND user_id=? LIMIT 1").bind(channel.channel_id, ctx.userId).first();
  return Response.json({ configured: true, callbackUrl: `${new URL(request.url).origin}/api/wechat/${channel.channel_id}`, token: channel.verify_token, linked: Boolean(link) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const ctx = await context(request);
  if (!ctx) return Response.json({ error: "请先登录" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "请求无效" }, { status: 400 }); }
  if (input.action === "create") {
    const existing = await ctx.db.prepare("SELECT 1 AS found FROM wechat_channels WHERE user_id=?").bind(ctx.userId).first();
    if (!existing) await ctx.db.prepare("INSERT INTO wechat_channels (user_id,channel_id,verify_token,created_at) VALUES (?,?,?,?)").bind(ctx.userId, randomHex(12), randomHex(16), new Date().toISOString()).run();
    return GET(request);
  }
  if (input.action === "code") {
    const channel = await ctx.db.prepare("SELECT channel_id FROM wechat_channels WHERE user_id=?").bind(ctx.userId).first<{channel_id:string}>();
    if (!channel) return Response.json({ error: "请先创建微信接入配置" }, { status: 400 });
    const code = randomHex(6).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await ctx.db.prepare("INSERT INTO wechat_bind_codes (channel_id,code_hash,expires_at) VALUES (?,?,?) ON CONFLICT(channel_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at").bind(channel.channel_id, await digestHex("SHA-256", code), expiresAt).run();
    return Response.json({ code, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "操作无效" }, { status: 400 });
}
