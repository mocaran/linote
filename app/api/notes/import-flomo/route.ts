import { env } from "cloudflare:workers";
import { sameOrigin, sessionUser } from "../../../../lib/auth";
import { parseFlomoExport } from "../../../../lib/flomo-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const user = await sessionUser(request);
  const db = env.DB;
  if (!user || !db) return Response.json({error:"请先登录"},{status:401});
  let html = "";
  try { const input = await request.json() as {html?:unknown}; if (typeof input.html === "string") html = input.html; }
  catch { return Response.json({error:"无法读取导出文件"},{status:400}); }
  let parsed: Awaited<ReturnType<typeof parseFlomoExport>>;
  try { parsed = await parseFlomoExport(html); }
  catch (error) { return Response.json({error:error instanceof Error ? error.message : "导出文件无效"},{status:400}); }
  const current = await db.prepare("SELECT id,body,created_at FROM notes WHERE user_id=?").bind(user.userId).all<{id:string;body:string;created_at:string}>();
  const ids = new Set(current.results.map(row => row.id));
  const content = new Set(current.results.map(row => row.created_at+"\n"+row.body));
  const additions = parsed.notes.filter(note => !ids.has(note.id) && !content.has(note.createdAt+"\n"+note.body));
  for (let index = 0; index < additions.length; index += 50) {
    const batch = additions.slice(index,index+50).map(note => db.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(user.userId,note.id,note.body,JSON.stringify(note.tags),note.createdAt,note.updatedAt));
    await db.batch(batch);
  }
  const after = await db.prepare("SELECT id,body,tags,created_at FROM notes WHERE user_id=?").bind(user.userId).all<{id:string;body:string;tags:string;created_at:string}>();
  const byId = new Map(after.results.map(row => [row.id,row]));
  const byContent = new Set(after.results.map(row => row.created_at+"\n"+row.body));
  const missing = parsed.notes.filter(note => !byId.has(note.id) && !byContent.has(note.createdAt+"\n"+note.body));
  const mismatched = parsed.notes.filter(note => {
    const saved = byId.get(note.id);
    return saved && (saved.body !== note.body || saved.created_at !== note.createdAt || saved.tags !== JSON.stringify(note.tags));
  });
  if (missing.length || mismatched.length) return Response.json({error:`导入后校验失败：缺失 ${missing.length} 条，不一致 ${mismatched.length} 条`},{status:500});
  return Response.json({sourceCount:parsed.notes.length,imported:additions.length,alreadyPresent:parsed.notes.length-additions.length,tagCount:parsed.tagCount,placeholderCount:parsed.placeholderCount,account:user.username},{headers:{"Cache-Control":"no-store"}});
}
