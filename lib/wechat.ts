export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, "0")).join("");
}

export async function digestHex(algorithm: "SHA-1" | "SHA-256", value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)));
  return Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
}

export async function validWechatSignature(token: string, timestamp: string | null, nonce: string | null, signature: string | null): Promise<boolean> {
  if (!timestamp || !nonce || !signature || !/^\d{1,13}$/.test(timestamp) || nonce.length > 128 || !/^[a-f0-9]{40}$/i.test(signature)) return false;
  const expected = await digestHex("SHA-1", [token, timestamp, nonce].sort().join(""));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return difference === 0;
}

function decodeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|\d+));/gi, entity => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const code = entity[2]?.toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function xmlField(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`));
  return match ? (match[1] ?? decodeXml(match[2] ?? "")) : "";
}

export function isWechatSaveCommand(body: string): boolean {
  return body.trim() === "以上";
}

export function composeWechatNote(messages: { body: string }[]): string {
  return messages.map(message => message.body.trim()).filter(Boolean).join("\n");
}

export function textReply(to: string, from: string, content: string): Response {
  const cdata = (value: string) => `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
  const xml = `<xml><ToUserName>${cdata(to)}</ToUserName><FromUserName>${cdata(from)}</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content>${cdata(content)}</Content></xml>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
