// Configure with your existing Supabase project and PUBLIC publishable/anon key.
// 'proxy' routes requests through this site's /api/* Cloudflare Pages Function.
// 'direct' connects to Supabase directly (rollback / troubleshooting).
window.OLP_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  publishableKey: 'sb_publishable_YOUR_PUBLIC_KEY',
  apiMode: 'proxy'
};
