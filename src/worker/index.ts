import handler from 'vinext/server/fetch-handler';

const worker = {
  ...handler,
  async fetch(request: Request, env: Cloudflare.Env, context: ExecutionContext) {
    const response = await handler.fetch(request, env, context);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    // Keep any stronger framework policy; this baseline does not block SSR scripts.
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "object-src 'none'; base-uri 'self'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

export default worker;
