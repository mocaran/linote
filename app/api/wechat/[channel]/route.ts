import { env } from "cloudflare:workers";
import { digestHex, textReply, validWechatSignature, xmlField } from "../../../../lib/wechat";

export const dynamic = "force-dynamic";

type Channel = { user_id: string; channel_id: string; verify_token: string };
async function checkedChannel(request: Request, channelId: string): Promise<Channel | null> {
  if (!env.DB || !/^[a-f0-9]{24}$/.test(channelId)) return null;
  const channel = await env.DB.prepare("SELECT user_id,channel_id,verify_token FROM wechat_channels WHERE channel_id=?").bind(channelId).first<Channel>();
  if (!channel) return null;
  const url = new URL(request.url);
  return await validWechatSignature(channel.verify_token, url.searchParams.get("timestamp"), url.searchParams.get("nonce"), url.searchParams.get("signature")) ? channel : null;
}

export async function GET(request: Request, context: { params: Promise<{ channel: string }> }) {
  const { channel: channelId } = await context.params;
  const channel = await checkedChannel(request, channelId);
  if (!channel) return new Response("Invalid signature", { status: 403 });
  const echostr = new URL(request.url).searchParams.get("echostr") || "";
  return new Response(echostr, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ channel: string }> }) {
  const { channel: channelId } = await context.params;
  const channel = await checkedChannel(request, channelId);
  if (!channel || !env.DB) return new Response("Invalid signature", { status: 403 });
  const url = new URL(request.url);
  if (url.searchParams.get("encrypt_type") === "aes" || url.searchParams.has("msg_signature")) return new Response("Encrypted mode is not configured", { status: 400 });
  const xml = await request.text();
  if (xml.length > 30000) return new Response("Message too large", { status: 413 });
  const to = xmlField(xml, "FromUserName");
  const from = xmlField(xml, "ToUserName");
  if (!to || !from) return new Response("Invalid message", { status: 400 });
  const kind = xmlField(xml, "MsgType").toLowerCase();
  if (kind === "event" && xmlField(xml, "Event").toLowerCase() === "subscribe") return textReply(to, from, "欢迎使用 linote。请先在 linote 的微信接入页面生成绑定口令，并发送“绑定 口令”。");
  if (kind !== "text") return textReply(to, from, "目前支持发送文字笔记。请发送文字，或先发送“绑定 口令”。");
  const body = xmlField(xml, "Content").trim();
  if (!body) return new Response("success");
  const bind = body.match(/^绑定\s+([A-Fa-f0-9]{12})$/);
  if (bind) {
    const codeHash = await digestHex("SHA-256", bind[1].toUpperCase());
    const code = await env.DB.prepare("SELECT code_hash FROM wechat_bind_codes WHERE channel_id=? AND code_hash=? AND expires_at>?").bind(channelId, codeHash, new Date().toISOString()).first();
    if (!code) return textReply(to, from, "绑定口令无效或已过期，请在 linote 重新生成。 ");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO wechat_links (channel_id,openid,user_id,created_at) VALUES (?,?,?,?) ON CONFLICT(channel_id,openid) DO UPDATE SET user_id=excluded.user_id").bind(channelId, to, channel.user_id, new Date().toISOString()),
      env.DB.prepare("DELETE FROM wechat_bind_codes WHERE channel_id=? AND code_hash=?").bind(channelId, codeHash),
    ]);
    return textReply(to, from, "已绑定 linote。现在发送文字，就会自动保存为笔记。");
  }
  const link = await env.DB.prepare("SELECT user_id FROM wechat_links WHERE channel_id=? AND openid=?").bind(channelId, to).first<{user_id:string}>();
  if (!link) return textReply(to, from, "尚未绑定 linote。请在 linote 的微信接入页面生成口令，然后发送“绑定 口令”。");
  if (body.length > 20000) return textReply(to, from, "文字太长，请拆成多条发送。");
  const msgId = xmlField(xml, "MsgId");
  const stableId = msgId ? `wx-${await digestHex("SHA-256", `${channelId}:${msgId}`)}` : `wx-${await digestHex("SHA-256", `${channelId}:${to}:${xmlField(xml,"CreateTime")}:${body}`)}`;
  const rawTime = Number(xmlField(xml, "CreateTime"));
  const createdAt = Number.isFinite(rawTime) && rawTime > 0 ? new Date(rawTime * 1000).toISOString() : new Date().toISOString();
  const tags = [...new Set(Array.from(body.matchAll(/(?:^|\s)#([^\s#]{1,60})/gu), match => match[1]))].slice(0, 30);
  await env.DB.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(link.user_id, stableId, body, JSON.stringify(tags), createdAt, createdAt).run();
  return textReply(to, from, "已保存到 linote。");
}
