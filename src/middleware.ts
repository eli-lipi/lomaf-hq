import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Paths that only admins should see/use. Middleware enforces redirects/403s here.
// Actual role check happens via a quick Supabase query below.
// v12.1 — /trades opened to all coaches (read). Page route is no longer
// admin-gated; write API actions are gated by HTTP method below.
const ADMIN_PAGE_PREFIXES = ['/upload', '/settings', '/round-control'];
const ADMIN_API_PREFIXES = [
  '/api/upload',
  '/api/rankings',
  '/api/score-adjustments',
  '/api/ai/intelligence-brief',
  '/api/ai/writeup-draft',
  '/api/users',
  // v12.3 — AFL injury sync + status are admin-only. The 'list' subroute
  // is exempt below — coaches read it for the /injuries page.
  '/api/afl-injuries/sync',
  '/api/afl-injuries/status',
];

// /api/afl-injuries/list is public-to-signed-in for the /injuries page.

// /api/trades — GET open to all coaches; POST/PATCH/DELETE admin-only.
const TRADES_API_PREFIX = '/api/trades';

// /api/round — most subroutes admin-only. /api/round/current is open
// because the round badge in the header reads it for everyone.
const ROUND_API_PREFIX = '/api/round';
const ROUND_API_PUBLIC_PATHS = ['/api/round/current'];

// Public paths (no auth required).
const PUBLIC_PATHS = ['/login', '/auth/callback'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired — required for Server Components to read it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Vercel cron requests don't have a session; let them pass through
  // and the route handler enforces its own auth via the same header.
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (isVercelCron) return response;

  // Not signed in: send to /login (unless already there).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Signed in visiting /login: bounce to home.
  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // /api/trades is special: GET (read) is open to all coaches, but any
  // mutating method (POST/PATCH/DELETE) still requires admin. The
  // recalculate sub-route and upload-screenshot sub-route are POSTs and
  // therefore correctly captured.
  const isTradesApi = path === TRADES_API_PREFIX || path.startsWith(TRADES_API_PREFIX + '/');
  const tradesNeedsAdmin = isTradesApi && request.method !== 'GET';

  // /api/round is admin-only, except the public /api/round/current
  // which the header badge reads.
  const isRoundApi = path === ROUND_API_PREFIX || path.startsWith(ROUND_API_PREFIX + '/');
  const isRoundPublic = ROUND_API_PUBLIC_PATHS.some((p) => path === p);
  const roundNeedsAdmin = isRoundApi && !isRoundPublic;

  // Admin-gated routes: look up role.
  const needsAdmin =
    ADMIN_PAGE_PREFIXES.some((p) => path === p || path.startsWith(p + '/')) ||
    ADMIN_API_PREFIXES.some((p) => path === p || path.startsWith(p + '/')) ||
    tradesNeedsAdmin ||
    roundNeedsAdmin;

  if (user && needsAdmin) {
    // Role is cached in a cookie at login (see /auth/callback) to avoid
    // a DB roundtrip on every request. If missing (legacy session),
    // fall back to a DB lookup just this once.
    let role = request.cookies.get('lomaf_role')?.value;
    if (!role) {
      const { data: appUser } = await supabase
        .from('users')
        .select('role')
        .eq('email', user.email?.toLowerCase() ?? '')
        .single();
      role = appUser?.role;
      if (role) {
        response.cookies.set('lomaf_role', role, {
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30,
        });
      }
    }

    // Honor "View as Member" cookie: admin viewing as coach gets blocked too.
    const viewAs = request.cookies.get('lomaf_view_as')?.value;
    const effectiveRole = role === 'admin' && viewAs === 'coach' ? 'coach' : role;

    // But: let admins toggle the cookie itself even while "in" member view.
    const isViewAsEndpoint = path === '/api/auth/view-as';

    if (effectiveRole !== 'admin' && !isViewAsEndpoint) {
      if (path.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/pwrnkgs';
      url.search = '?tab=previous';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Run on everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)$).*)'],
};
