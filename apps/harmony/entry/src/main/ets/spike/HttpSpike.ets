import { http } from '@kit.NetworkKit';

// M0 spike②：@ohos.net.http 流式 SSE 接收验证（dataReceive 累积 + 行解析）
// 依次尝试候选宿主地址（模拟器 NAT 网关 / 宿主局域网 IP），成功一个即返回。

function trySse(url: string): Promise<string> {
  return new Promise<string>((resolve: (v: string) => void) => {
    const client: http.HttpRequest = http.createHttp();
    let received: string = '';
    let chunks: number = 0;
    const finish = (result: string): void => {
      client.off('dataReceive');
      client.off('dataEnd');
      client.destroy();
      resolve(result);
    };
    client.on('dataReceive', (chunk: ArrayBuffer): void => {
      // 逐块解码，验证流式增量可解析
      const bytes: Uint8Array = new Uint8Array(chunk);
      let text: string = '';
      for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
      }
      received += text;
      for (const line of received.split('\n')) {
        if (line.startsWith('data:')) {
          chunks++;
        }
      }
    });
    client.on('dataEnd', (): void => {
      const done: boolean = received.includes('[DONE]');
      finish(`${url} -> data块行数=${chunks} DONE=${done}`);
    });
    try {
      client.requestInStream(url, {
        method: http.RequestMethod.GET,
        connectTimeout: 4000,
        readTimeout: 15000
      }).catch((err: Error): void => {
        finish(`${url} -> FAIL:${err.message}`);
      });
    } catch (e) {
      finish(`${url} -> THROW:${(e as Error).message}`);
    }
  });
}

export async function runSseSpike(): Promise<string> {
  const candidates: string[] = [
    'http://10.0.2.2:18788/sse',
    'http://192.168.8.224:18788/sse',
    'http://172.21.64.1:18788/sse'
  ];
  const results: string[] = [];
  for (const url of candidates) {
    const r: string = await trySse(url);
    results.push(r);
    if (r.includes('DONE=true')) {
      break;
    }
  }
  return results.join(' | ');
}
