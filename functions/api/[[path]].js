// Cloudflare Pages Function: restricted same-origin Supabase API relay.
// Set SUPABASE_URL in Pages > Settings > Variables and Secrets.
// Do not use service_role credentials. RLS remains enforced by Supabase.
const ALLOWED = /^\/(auth\/v1|rest\/v1|storage\/v1)(\/|$)/;
const BLOCKED = /^\/auth\/v1\/(admin|settings)(\/|$)/;
const HEADERS = ['apikey','authorization','content-type','accept','prefer','range',
  'content-range','x-upsert','x-client-info','cache-control'];
const RESPONSE_HEADERS = ['content-type','content-range','range-unit','location',
  'x-total-count','www-authenticate','content-disposition'];
export async function onRequest(context) {
  const {request,env}=context;
  const url=new URL(request.url);
  const path=url.pathname.replace(/^\/api(?=\/|$)/,'');
  if (!ALLOWED.test(path) || BLOCKED.test(path))
    return new Response('API route not allowed',{status:404});
  if (!['GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'].includes(request.method))
    return new Response('Method not allowed',{status:405});
  if (request.method==='OPTIONS')
    return new Response(null,{status:204,headers:{Allow:'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS'}});
  const upstream=(env.SUPABASE_URL||'').replace(/\/$/,'');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(upstream))
    return new Response('Proxy configuration missing or invalid',{status:503});
  const target=new URL(upstream+path+url.search);
  const headers=new Headers();
  for (const name of HEADERS) {
    const value=request.headers.get(name);
    if (value!==null)headers.set(name,value);
  }
  // No credential injection: pass through the user's publishable key and JWT.
  // Avoid forwarding browser cookies and Cloudflare credentials.
  try {
    const response=await fetch(target.toString(),{
      method:request.method,
      headers,
      body:['GET','HEAD'].includes(request.method)?undefined:request.body,
      redirect:'manual',
      cache:'no-store'
    });
    const outputHeaders=new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value=response.headers.get(name);
      if(value!==null)outputHeaders.set(name,value);
    }
    outputHeaders.set('cache-control','no-store');
    outputHeaders.set('x-content-type-options','nosniff');
    return new Response(response.body,{status:response.status,headers:outputHeaders});
  } catch (err) {
    return new Response(JSON.stringify({message:'Upstream connection failed'}),{
      status:502,headers:{'content-type':'application/json','cache-control':'no-store'}
    });
  }
}
