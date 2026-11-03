import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { accountIdFromRequest } from "../../../../lib/account-id";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const accountId = accountIdFromRequest(request);
  if (!accountId || !env.DB) return Response.json({error:"无效编号"}, {status:400});
  const user = await getChatGPTUser();
  if (!user) return Response.json({imported:0,available:false});
  const result = await env.DB.prepare("INSERT OR IGNORE INTO notes (user_id,id,body,tags,created_at,updated_at) SELECT ?,id,body,tags,created_at,updated_at FROM notes WHERE user_id = ?").bind(accountId,user.userId).run();
  return Response.json({imported:result.meta.changes || 0,available:true});
}
