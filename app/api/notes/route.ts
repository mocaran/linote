import { env } from "cloudflare:workers";
import { accountIdFromRequest } from "../../../lib/account-id";

export const dynamic = "force-dynamic";

type Note = { id: string; body: string; tags: string[]; createdAt: string; updatedAt: string };

function validateNote(value: unknown): Note | null {
  if (!value || typeof value !== "object") return null;
  const n = value as Record<string, unknown>;
  if (typeof n.id !== "string" || !n.id || n.id.length > 100 || typeof n.body !== "string" || !n.body.trim() || n.body.length > 20000) return null;
  if (!Array.isArray(n.tags) || n.tags.length > 30 || n.tags.some(t => typeof t !== "string" || !t || t.length > 60)) return null;
  const createdAt = typeof n.createdAt === "string" && !Number.isNaN(Date.parse(n.createdAt)) ? n.createdAt : new Date().toISOString();
  const updatedAt = typeof n.updatedAt === "string" && !Number.isNaN(Date.parse(n.updatedAt)) ? n.updatedAt : createdAt;
  return { id:n.id, body:n.body.trim(), tags:[...new Set(n.tags as string[])], createdAt, updatedAt };
}

function context(request: Request) {
  const userId = accountIdFromRequest(request);
  if (!userId || !env.DB) return null;
  return { db: env.DB, userId };
}

export async function GET(request: Request) {
  const ctx = context(request);
  if (!ctx) return Response.json({error:"请先输入有效的笔记编号"}, {status:400});
  const result = await ctx.db.prepare("SELECT id, body, tags, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC").bind(ctx.userId).all();
  return Response.json({notes: result.results.map(row => ({id:row.id, body:row.body, tags:JSON.parse(String(row.tags || "[]")), createdAt:row.created_at, updatedAt:row.updated_at}))}, {headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  const ctx = context(request);
  if (!ctx) return Response.json({error:"请先输入有效的笔记编号"}, {status:400});
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({error:"无效数据"}, {status:400}); }
  const note = validateNote(value);
  if (!note) return Response.json({error:"笔记内容无效"}, {status:400});
  await ctx.db.prepare("INSERT INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET body=excluded.body,tags=excluded.tags,updated_at=excluded.updated_at").bind(ctx.userId,note.id,note.body,JSON.stringify(note.tags),note.createdAt,note.updatedAt).run();
  return Response.json({note});
}

export async function PUT(request: Request) {
  const ctx = context(request);
  if (!ctx) return Response.json({error:"请先输入有效的笔记编号"}, {status:400});
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({error:"无效数据"}, {status:400}); }
  if (!Array.isArray(value) || value.length > 1000) return Response.json({error:"导入数量过多"}, {status:400});
  const notes = value.map(validateNote);
  if (notes.some(n => !n)) return Response.json({error:"笔记内容无效"}, {status:400});
  const batch = (notes as Note[]).map(n => ctx.db.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(ctx.userId,n.id,n.body,JSON.stringify(n.tags),n.createdAt,n.updatedAt));
  if (batch.length) await ctx.db.batch(batch);
  return Response.json({imported:batch.length});
}

export async function DELETE(request: Request) {
  const ctx = context(request);
  if (!ctx) return Response.json({error:"请先输入有效的笔记编号"}, {status:400});
  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 100) return Response.json({error:"缺少笔记 ID"}, {status:400});
  await ctx.db.prepare("DELETE FROM notes WHERE user_id = ? AND id = ?").bind(ctx.userId,id).run();
  return Response.json({ok:true});
}
