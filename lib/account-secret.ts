import { env } from "cloudflare:workers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function fromHex(value: string): Uint8Array { return Uint8Array.from(value.match(/.{2}/g)?.map(part => parseInt(part, 16)) || []); }

async function encryptionKey(): Promise<CryptoKey> {
  const secret = (env as unknown as { LINOTE_KEY_ENCRYPTION_SECRET?: string }).LINOTE_KEY_ENCRYPTION_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("密钥存储尚未配置");
  return crypto.subtle.importKey("raw", Uint8Array.from(fromHex(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptApiKey(value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = Uint8Array.from(crypto.getRandomValues(new Uint8Array(12)));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(value));
  return { ciphertext: hex(new Uint8Array(ciphertext)), iv: hex(iv) };
}

export async function decryptApiKey(ciphertext: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(fromHex(iv)) }, await encryptionKey(), Uint8Array.from(fromHex(ciphertext)));
  return decoder.decode(plain);
}
