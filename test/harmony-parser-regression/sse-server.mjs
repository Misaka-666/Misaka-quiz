// M0 spike②：本地 SSE 服务端，模拟 OpenAI 兼容流式接口
// 运行：node sse-server.mjs（绑定 0.0.0.0:8788，供模拟器访问宿主）
import http from 'node:http';

let conn = 0;
const server = http.createServer((req, res) => {
  if (!req.url || !req.url.startsWith('/sse')) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  conn++;
  console.log(`[sse] conn#${conn} ${req.socket.remoteAddress}`);
  let i = 0;
  const timer = setInterval(() => {
    i++;
    res.write(`data: {"delta":"块${i}"}\n\n`);
    if (i >= 5) {
      res.write('data: [DONE]\n\n');
      clearInterval(timer);
      res.end();
    }
  }, 400);
  req.on('close', () => clearInterval(timer));
});
server.listen(18788, '0.0.0.0', () => console.log('[sse] listening 0.0.0.0:18788'));
