import { env } from "cloudflare:workers";
import { clearSession, createSession, hashPassword, newSalt, normalizeUsername, sameOrigin, sessionUser, validPassword, verifyPassword } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await sessionUser(request);
  return user ? Response.json({username:user.username},{headers:{"Cache-Control":"no-store"}}) : Response.json({error:"未登录"},{status:401,headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  if (!env.DB) return Response.json({error:"数据库不可用"},{status:503});
  let body: Record<string,unknown>;
  try { body = await request.json(); } catch { return Response.json({error:"请求无效"},{status:400}); }
  if (body.action === "logout") return Response.json({ok:true},{headers:{"Set-Cookie":await clearSession(request)}});
  const username = normalizeUsername(body.username);
  const password = body.password;
  if (!username || !validPassword(password)) return Response.json({error:"账号需为 1 至 32 个字符，密码需为文本"},{status:400});
  const account = await env.DB.prepare("SELECT password_hash,salt FROM accounts WHERE username = ?").bind(username).first<{password_hash:string;salt:string}>();
  if (body.action === "register") {
    if (account) return Response.json({error:"账号已存在，请登录"},{status:409});
    const salt = newSalt();
    const passwordHash = await hashPassword(password,salt);
    try { await env.DB.prepare("INSERT INTO accounts (username,password_hash,salt,created_at) VALUES (?,?,?,?)").bind(username,passwordHash,salt,new Date().toISOString()).run(); }
    catch { return Response.json({error:"账号已存在，请登录"},{status:409}); }
  } else if (body.action === "login") {
    if (!account || !(await verifyPassword(password,account.salt,account.password_hash))) return Response.json({error:"账号或密码错误"},{status:401});
  } else return Response.json({error:"操作无效"},{status:400});
  return Response.json({username},{headers:{"Set-Cookie":await createSession(request,`id:${username}`),"Cache-Control":"no-store"}});
}
