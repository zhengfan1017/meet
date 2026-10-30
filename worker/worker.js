const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }
    const expected = env.TRAEBAO_ACCESS_TOKEN;
    if (expected && request.headers.get('X-Access-Token') !== expected) {
      return new Response('unauthorized', { status: 401 });
    }
    const upstream = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ARK_API_KEY}`,
      },
      body: await request.text(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
