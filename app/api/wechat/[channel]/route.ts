import { env } from "cloudflare:workers";
import { composeWechatNote, digestHex, isWechatSaveCommand, textReply, validWechatSignature, xmlField } from "../../../../lib/wechat";

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
  if (kind === "event" && xmlField(xml, "Event").toLowerCase() === "subscribe") return textReply(to, from, "欢迎使用 linote。先在微信接入页面生成口令，发送“绑定 口令”。之后可连续发送文字，单独发送“以上”时合并保存为一篇笔记。");
  if (kind !== "text") return textReply(to, from, "目前支持发送文字。连续发送的文字会暂存，单独发送“以上”后合并保存。");
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
    return textReply(to, from, "已绑定 linote。现在可连续发送文字，单独发送“以上”后会合并保存为一篇笔记。");
  }
  const link = await env.DB.prepare("SELECT user_id FROM wechat_links WHERE channel_id=? AND openid=?").bind(channelId, to).first<{user_id:string}>();
  if (!link) return textReply(to, from, "尚未绑定 linote。请在 linote 的微信接入页面生成口令，然后发送“绑定 口令”。");
  if (body.length > 20000) return textReply(to, from, "文字太长，请拆成多条发送。");
  const msgId = xmlField(xml, "MsgId");
  const stableId = `wx-${await digestHex("SHA-256", msgId ? `${channelId}:${msgId}` : `${channelId}:${to}:${xmlField(xml,"CreateTime")}:${body}`)}`;
  const rawTime = Number(xmlField(xml, "CreateTime"));
  const createdAt = Number.isFinite(rawTime) && rawTime > 0 ? new Date(rawTime * 1000).toISOString() : new Date().toISOString();
  const isEnd = isWechatSaveCommand(body);
  await env.DB.prepare("INSERT OR IGNORE INTO wechat_inbox (channel_id,openid,message_id,kind,body,created_at) VALUES (?,?,?,?,?,?)")
    .bind(channelId, to, stableId, isEnd ? "end" : "text", isEnd ? "" : body, createdAt).run();
  if (!isEnd) return textReply(to, from, "已暂存。继续发送文字，最后单独发送“以上”即可合并保存。");

  const marker = await env.DB.prepare("SELECT id FROM wechat_inbox WHERE channel_id=? AND openid=? AND message_id=? AND kind='end'")
    .bind(channelId, to, stableId).first<{id:number}>();
  if (!marker) return new Response("Message not found", {status:500});
  const previous = await env.DB.prepare("SELECT MAX(id) AS id FROM wechat_inbox WHERE channel_id=? AND openid=? AND kind='end' AND id<?")
    .bind(channelId, to, marker.id).first<{id:number|null}>();
  const messages = await env.DB.prepare("SELECT body,created_at FROM wechat_inbox WHERE channel_id=? AND openid=? AND kind='text' AND id>? AND id<? ORDER BY id")
    .bind(channelId, to, previous?.id ?? 0, marker.id).all<{body:string;created_at:string}>();
  const noteBody = composeWechatNote(messages.results);
  if (!noteBody) {
    const saved = await env.DB.prepare("SELECT id FROM notes WHERE user_id=? AND id=?").bind(link.user_id, stableId).first();
    return textReply(to, from, saved ? "这段内容已保存到 linote。" : "目前没有待保存的文字。先发内容，再单独发送“以上”。");
  }
  const tags = [...new Set(Array.from(noteBody.matchAll(/(?:^|\s)#([^\s#]{1,60})/gu), match => match[1]))].slice(0, 30);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(link.user_id, stableId, noteBody, JSON.stringify(tags), messages.results[0].created_at, createdAt),
    env.DB.prepare("UPDATE wechat_inbox SET body='' WHERE channel_id=? AND openid=? AND kind='text' AND id>? AND id<?")
      .bind(channelId, to, previous?.id ?? 0, marker.id),
  ]);
  return textReply(to, from, `已将 ${messages.results.length} 条消息合并保存到 linote。`);
}
