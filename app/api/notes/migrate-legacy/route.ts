import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { sameOrigin, sessionUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const account = await sessionUser(request);
  if (!account || !env.DB) return Response.json({error:"请先登录"}, {status:401});
  const user = await getChatGPTUser();
  if (!user) return Response.json({imported:0,available:false});
  const result = await env.DB.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) SELECT ?,id,body,tags,created_at,updated_at FROM notes WHERE user_id = ?").bind(account.userId,user.userId).run();
  return Response.json({imported:result.meta.changes || 0,available:true});
}
