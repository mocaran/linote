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
  const rows = await ctx.db.prepare("SELECT c.channel_id,c.verify_token,COUNT(l.openid) AS linked_count FROM wechat_channels c LEFT JOIN wechat_links l ON l.channel_id=c.channel_id AND l.user_id=c.user_id WHERE c.user_id=? GROUP BY c.channel_id,c.verify_token,c.created_at ORDER BY c.created_at,c.channel_id").bind(ctx.userId).all<{channel_id:string;verify_token:string;linked_count:number}>();
  const channels = rows.results.map(row => ({
    channelId: row.channel_id,
    callbackUrl: `${new URL(request.url).origin}/api/wechat/${row.channel_id}`,
    token: row.verify_token,
    linkedCount: Number(row.linked_count),
  }));
  const first = channels[0];
  return Response.json({ configured: channels.length > 0, channels, callbackUrl: first?.callbackUrl, token: first?.token, linked: Boolean(first?.linkedCount) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  const ctx = await context(request);
  if (!ctx) return Response.json({ error: "请先登录" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "请求无效" }, { status: 400 }); }
  if (input.action === "create") {
    const existing = await ctx.db.prepare("SELECT COUNT(*) AS count FROM wechat_channels WHERE user_id=?").bind(ctx.userId).first<{count:number}>();
    if (Number(existing?.count) >= 2) return Response.json({ error: "当前账号最多接入两个公众号" }, { status: 400 });
    await ctx.db.prepare("INSERT INTO wechat_channels (user_id,channel_id,verify_token,created_at) VALUES (?,?,?,?)").bind(ctx.userId, randomHex(12), randomHex(16), new Date().toISOString()).run();
    return GET(request);
  }
  if (input.action === "code") {
    const selectedId = typeof input.channelId === "string" && /^[a-f0-9]{24}$/.test(input.channelId) ? input.channelId : null;
    const channel = selectedId
      ? await ctx.db.prepare("SELECT channel_id FROM wechat_channels WHERE user_id=? AND channel_id=?").bind(ctx.userId, selectedId).first<{channel_id:string}>()
      : await ctx.db.prepare("SELECT channel_id FROM wechat_channels WHERE user_id=? ORDER BY created_at,channel_id LIMIT 1").bind(ctx.userId).first<{channel_id:string}>();
    if (!channel) return Response.json({ error: "未找到此公众号的接入配置" }, { status: 400 });
    const code = randomHex(6).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await ctx.db.prepare("INSERT INTO wechat_bind_codes (channel_id,code_hash,expires_at) VALUES (?,?,?) ON CONFLICT(channel_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at").bind(channel.channel_id, await digestHex("SHA-256", code), expiresAt).run();
    return Response.json({ code, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "操作无效" }, { status: 400 });
}
