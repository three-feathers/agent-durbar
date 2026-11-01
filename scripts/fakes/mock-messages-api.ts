/**
 * A loopback mock of the Anthropic Messages API for `npm run test:prereview` (spec 103, review 2026-11-01). It lets the REAL pinned Agent
 * SDK binary run a whole session with a fake key and no network beyond 127.0.0.1: the "model" answers with the tool calls a test scripts
 * (hostile paths included), and every request body is recorded so a test can prove a canary never reached the model.
 * It spends nothing: nothing here talks to any other host.
 */
import * as http from 'http';

export type Block = { type: 'tool_use'; name: string; input: unknown } | { type: 'text'; text: string };
/** Answers turn `n` (0-based) given the request body; return the blocks of the assistant message. */
export type Turn = (n: number, body: any) => Block[];
export interface MockApi { url: string; requests: Array<{ method: string; path: string; body: any }>; close(): Promise<void> }

const sse = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function startMockApi(turn: Turn): Promise<MockApi> {
  const requests: MockApi['requests'] = []; let n = 0; let seq = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: any = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
      const p = (req.url ?? '').split('?')[0];
      requests.push({ method: req.method ?? '', path: p, body });
      if (req.method === 'POST' && p === '/v1/messages') {
        const blocks = turn(n++, body);
        const content = blocks.map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: `toolu_${++seq}`, name: b.name, input: b.input } : { type: 'text', text: b.text }));
        const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
        const model = body && typeof body.model === 'string' ? body.model : 'claude-opus-5-5';
        const usage = { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        if (body && body.stream === false) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: `msg_${seq}`, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage }));
          return;
        }
        let out = sse('message_start', { type: 'message_start', message: { id: `msg_${seq}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
        content.forEach((c: any, i: number) => {
          if (c.type === 'text') {
            out += sse('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
            out += sse('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: c.text } });
          } else {
            out += sse('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} } });
            out += sse('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } });
          }
          out += sse('content_block_stop', { type: 'content_block_stop', index: i });
        });
        out += sse('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
        out += sse('message_stop', { type: 'message_stop' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.end(out);
        return;
      }
      if (req.method === 'POST' && p === '/v1/messages/count_tokens') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: 100 })); return; }
      res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'mock: no such route' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${addr.port}`, requests, close: () => new Promise<void>((r) => { server.close(() => r()); (server as any).closeAllConnections?.(); }) });
  }));
}
