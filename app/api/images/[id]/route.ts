import { env } from "cloudflare:workers";
import { sameOrigin, sessionUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

function imageId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }

export async function GET(request: Request, {params}: {params: Promise<{id:string}>}) {
  const user = await sessionUser(request);
  const {id} = await params;
  if (!user || !env.BUCKET || !imageId(id)) return new Response(null,{status:404});
  const image = await env.BUCKET.get(`${user.userId}/${id}`);
  if (!image) return new Response(null,{status:404});
  return new Response(image.body,{headers:{"Content-Type":image.httpMetadata?.contentType || "image/jpeg","Cache-Control":"private, max-age=604800","X-Content-Type-Options":"nosniff"}});
}

export async function PUT(request: Request, {params}: {params: Promise<{id:string}>}) {
  if (!sameOrigin(request)) return Response.json({error:"请求来源无效"},{status:403});
  const user = await sessionUser(request);
  const {id} = await params;
  if (!user || !env.BUCKET) return Response.json({error:"请先登录"},{status:401});
  if (!imageId(id)) return Response.json({error:"图片编号无效"},{status:400});
  const type = request.headers.get("Content-Type") || "";
  if (!/^image\/(?:jpeg|png|webp|gif)$/.test(type)) return Response.json({error:"图片格式不支持"},{status:415});
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 15_000_000) return Response.json({error:"图片不能超过 15 MB"},{status:413});
  await env.BUCKET.put(`${user.userId}/${id}`,bytes,{httpMetadata:{contentType:type}});
  return Response.json({ok:true});
}
