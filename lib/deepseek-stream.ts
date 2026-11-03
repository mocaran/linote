export type StreamEvent = "progress" | "reasoning" | "answer" | "done" | "error";
export type StreamSender = (event: StreamEvent, data: Record<string, unknown>) => void;

export async function readDeepSeekStream(response: Response, send: StreamSender): Promise<{content:string;reasoning:string}> {
  if (!response.body) throw new Error("DeepSeek 没有返回内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", content = "", reasoning = "";
  while (true) {
    const {value,done} = await reader.read();
    pending += decoder.decode(value || new Uint8Array(),{stream:!done});
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0,newline).trim();
      pending = pending.slice(newline+1);
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") continue;
      let delta: {content?:string|null;reasoning_content?:string|null} | undefined;
      try { delta = JSON.parse(raw).choices?.[0]?.delta; } catch { continue; }
      if (delta?.reasoning_content) { reasoning += delta.reasoning_content; send("reasoning",{text:delta.reasoning_content}); }
      if (delta?.content) { content += delta.content; send("answer",{text:delta.content}); }
    }
    if (done) break;
  }
  if (!content.trim()) throw new Error("DeepSeek 没有返回完整答复");
  return {content:content.trim(),reasoning:reasoning.trim()};
}

export function sseResponse(run: (send: StreamSender) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: StreamSender = (event,data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      void run(send).catch(error => send("error",{error:error instanceof Error ? error.message : "生成失败"})).finally(() => controller.close());
    },
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform","X-Content-Type-Options":"nosniff"}});
}
