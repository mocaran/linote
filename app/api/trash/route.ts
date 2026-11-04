import { env } from "cloudflare:workers";
import { sameOrigin, sessionUser } from "../../../lib/auth";

export const dynamic = "force-dynamic";

type TrashRow = {id:string;kind:string;payload:string;deleted_at:string};
type Note = {id:string;body:string;tags:string[];createdAt:string;updatedAt:string};
type Insight = {id:string;mode:string;title:string;scope:string;noteCount:number;content:string;createdAt:string};

function validKind(value: unknown): value is "note" | "insight" { return value === "note" || value === "insight"; }
function validId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 100; }
function validNote(value: unknown, id: string): value is Note {
  if (!value || typeof value !== "object") return false;
  const note=value as Record<string,unknown>;
  return note.id === id && typeof note.body === "string" && note.body.length > 0 && note.body.length < 1_800_000 && Array.isArray(note.tags) && note.tags.every(tag => typeof tag === "string") && typeof note.createdAt === "string" && typeof note.updatedAt === "string";
}

export async function GET(request: Request) {
  const user=await sessionUser(request);
  if (!user || !env.DB) return Response.json({error:"请先登录"},{status:401});
  const rows=await env.DB.prepare("SELECT id,kind,payload,deleted_at FROM trash_items WHERE user_id=? ORDER BY deleted_at DESC LIMIT 200").bind(user.userId).all<TrashRow>();
  return Response.json({items:rows.results.map(row => ({id:row.id,kind:row.kind,item:JSON.parse(row.payload),deletedAt:row.deleted_at}))},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const user=await sessionUser(request);
  if (!user || !env.DB) return Response.json({error:"请先登录"},{status:401});
  let input: Record<string,unknown>;
  try { input=await request.json(); } catch { return Response.json({error:"请求无效"},{status:400}); }
  if (!validKind(input.kind) || !validId(input.id)) return Response.json({error:"项目无效"},{status:400});
  let item: Note | Insight | null = null;
  if (input.kind === "note") {
    const row=await env.DB.prepare("SELECT id,body,tags,created_at,updated_at FROM notes WHERE user_id=? AND id=?").bind(user.userId,input.id).first<{id:string;body:string;tags:string;created_at:string;updated_at:string}>();
    if (row) item={id:row.id,body:row.body,tags:JSON.parse(row.tags),createdAt:row.created_at,updatedAt:row.updated_at};
    else if (validNote(input.item,input.id)) item=input.item;
  } else {
    const row=await env.DB.prepare("SELECT id,mode,title,scope,note_count,content,created_at FROM insights WHERE user_id=? AND id=?").bind(user.userId,input.id).first<{id:string;mode:string;title:string;scope:string;note_count:string;content:string;created_at:string}>();
    if (row) item={id:row.id,mode:row.mode,title:row.title,scope:row.scope,noteCount:Number(row.note_count),content:row.content,createdAt:row.created_at};
  }
  if (!item) return Response.json({error:"找不到该项目"},{status:404});
  const deletedAt=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO trash_items (user_id,id,kind,payload,deleted_at) VALUES (?,?,?,?,?)").bind(user.userId,input.id,input.kind,JSON.stringify(item),deletedAt),
    env.DB.prepare(input.kind === "note" ? "DELETE FROM notes WHERE user_id=? AND id=?" : "DELETE FROM insights WHERE user_id=? AND id=?").bind(user.userId,input.id),
  ]);
  return Response.json({entry:{id:input.id,kind:input.kind,item,deletedAt}});
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const user=await sessionUser(request);
  if (!user || !env.DB) return Response.json({error:"请先登录"},{status:401});
  let input: Record<string,unknown>;
  try { input=await request.json(); } catch { return Response.json({error:"请求无效"},{status:400}); }
  if (!validKind(input.kind) || !validId(input.id)) return Response.json({error:"项目无效"},{status:400});
  const row=await env.DB.prepare("SELECT payload FROM trash_items WHERE user_id=? AND kind=? AND id=?").bind(user.userId,input.kind,input.id).first<{payload:string}>();
  if (!row) return Response.json({error:"回收站中没有该项目"},{status:404});
  const item=JSON.parse(row.payload) as Note | Insight;
  const insert=input.kind === "note" ?
    env.DB.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(user.userId,item.id,(item as Note).body,JSON.stringify((item as Note).tags),(item as Note).createdAt,(item as Note).updatedAt) :
    env.DB.prepare("INSERT OR IGNORE INTO insights (user_id,id,mode,title,scope,note_count,content,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(user.userId,item.id,(item as Insight).mode,(item as Insight).title,(item as Insight).scope,String((item as Insight).noteCount),(item as Insight).content,(item as Insight).createdAt);
  await env.DB.batch([insert,env.DB.prepare("DELETE FROM trash_items WHERE user_id=? AND kind=? AND id=?").bind(user.userId,input.kind,input.id)]);
  return Response.json({item});
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const user=await sessionUser(request);
  if (!user || !env.DB) return Response.json({error:"请先登录"},{status:401});
  const url=new URL(request.url);
  const kind=url.searchParams.get("kind"), id=url.searchParams.get("id");
  if (!validKind(kind) || !validId(id)) return Response.json({error:"项目无效"},{status:400});
  const row=await env.DB.prepare("SELECT payload FROM trash_items WHERE user_id=? AND kind=? AND id=?").bind(user.userId,kind,id).first<{payload:string}>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM trash_items WHERE user_id=? AND kind=? AND id=?").bind(user.userId,kind,id),
    env.DB.prepare(kind === "note" ? "DELETE FROM notes WHERE user_id=? AND id=?" : "DELETE FROM insights WHERE user_id=? AND id=?").bind(user.userId,id),
  ]);
  if (kind === "note" && row && env.BUCKET) {
    const body=(JSON.parse(row.payload) as Note).body;
    const matches=body.matchAll(/\/api\/images\/([0-9a-f-]{36})/gi);
    for (const match of matches) {
      const ref=`/api/images/${match[1]}`;
      const active=await env.DB.prepare("SELECT 1 FROM notes WHERE user_id=? AND body LIKE ? LIMIT 1").bind(user.userId,`%${ref}%`).first();
      const discarded=await env.DB.prepare("SELECT 1 FROM trash_items WHERE user_id=? AND payload LIKE ? LIMIT 1").bind(user.userId,`%${ref}%`).first();
      if (!active && !discarded) await env.BUCKET.delete(`${user.userId}/${match[1]}`).catch(() => {});
    }
  }
  return Response.json({ok:true});
}
