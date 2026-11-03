import { env } from "cloudflare:workers";
import { sessionUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user || !env.DB) return Response.json({ error: "请先登录" }, { status: 401 });
  const rows = await env.DB.prepare("SELECT id,body,tags,created_at,updated_at FROM notes WHERE user_id=? ORDER BY created_at DESC").bind(user.userId).all<{id:string;body:string;tags:string;created_at:string;updated_at:string}>();
  const notes = rows.results.map(row => ({ id:row.id,body:row.body,tags:JSON.parse(row.tags),createdAt:row.created_at,updatedAt:row.updated_at }));
  const content = JSON.stringify({ app:"linote",exportedAt:new Date().toISOString(),notes },null,2);
  return new Response(content,{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="linote-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"no-store"}});
}
