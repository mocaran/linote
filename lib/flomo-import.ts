export type ImportedNote = {id:string;body:string;tags:string[];createdAt:string;updatedAt:string};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|hellip);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2),16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1),10));
    return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",hellip:"…"} as Record<string,string>)[entity.toLowerCase()] || `&${entity};`;
  });
}

function plainText(markup: string): string {
  return decode(markup
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<li\b[^>]*>/gi,"• ")
    .replace(/<\/p>|<\/li>|<\/h[1-6]>|<\/blockquote>/gi,"\n")
    .replace(/<[^>]+>/g,"")
    .replace(/\r/g,"")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{4,}/g,"\n\n\n")).trim();
}

async function sourceId(time: string, body: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(time+"\n"+body)));
  return "flomo-"+Array.from(bytes,b => b.toString(16).padStart(2,"0")).join("");
}

export async function parseFlomoExport(source: string): Promise<{notes:ImportedNote[];tagCount:number;placeholderCount:number}> {
  if (source.length > 2_000_000) throw new Error("导出文件过大");
  const menu = source.match(/<select name="tag" id="tag">([\s\S]*?)<\/select>/)?.[1];
  if (!menu) throw new Error("找不到 flomo 标签列表");
  const vocabulary = [...menu.matchAll(/<option value="([^"]+)"/g)].map(match => decode(match[1])).sort((a,b) => b.length-a.length);
  const blocks = source.split('<div class="memo">').slice(1);
  if (!blocks.length || blocks.length > 1000) throw new Error("笔记数量无效");
  const notes: ImportedNote[] = [];
  let placeholderCount = 0;
  for (const [index,block] of blocks.entries()) {
    const time = block.match(/<div class="time">([^<]+)<\/div>/)?.[1]?.trim();
    const markup = block.match(/<div class="content">([\s\S]*?)<\/div>\s*<div class="files">/)?.[1];
    if (!time || markup === undefined || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) throw new Error(`第 ${index+1} 条笔记格式无效`);
    const date = new Date(time.replace(" ","T")+"+08:00");
    if (Number.isNaN(date.getTime())) throw new Error(`第 ${index+1} 条笔记时间无效`);
    const content = plainText(markup);
    if (!content) placeholderCount++;
    const body = content || "[原笔记只有图片或附件，未导入文件]";
    const tags = vocabulary.filter(tag => {
      const position = body.indexOf("#"+tag);
      return position >= 0 && !/^[\p{L}\p{N}_/]/u.test(body.slice(position+tag.length+1));
    });
    if (body.length > 20000 || tags.length > 30 || tags.some(tag => tag.length > 60)) throw new Error(`第 ${index+1} 条笔记超出 linote 限制`);
    const createdAt = date.toISOString();
    notes.push({id:await sourceId(time,body),body,tags,createdAt,updatedAt:createdAt});
  }
  if (new Set(notes.map(note => note.id)).size !== notes.length) throw new Error("导出文件中有重复笔记");
  return {notes,tagCount:vocabulary.length,placeholderCount};
}
