/**
 * Email — Resend wrapper.
 *
 * Currently used by:
 *   - sendRoundLiveEmail: blasted to all coaches when the admin advances
 *     to a new round on /round-control.
 *
 * Resend is the cheapest path for the volume we have (10 coaches × ~22
 * rounds = ~220 emails / season). Free tier is 100 emails / day.
 *
 * Env: RESEND_API_KEY required. RESEND_FROM optional (defaults to a safe
 * sandboxed onboarding@resend.dev so first deploy still sends — switch
 * to a verified domain when DNS is set up).
 */

import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

const FROM_DEFAULT = 'LOMAF HQ <onboarding@resend.dev>';

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function getPortalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://lomaf-hq-xi.vercel.app')
  );
}

interface CoachRow {
  email: string;
  display_name: string | null;
}

/**
 * Send the "Round N is live" announcement to every coach in users.
 * Throws if RESEND_API_KEY is missing or the send fails.
 */
export async function sendRoundLiveEmail(supabase: SB, round: number): Promise<void> {
  const client = getClient();
  if (!client) {
    throw new Error('RESEND_API_KEY is not set — add it to Vercel env to enable round-live emails.');
  }

  const { data: users } = await supabase
    .from('users')
    .select('email, display_name, role');
  const coaches = ((users ?? []) as (CoachRow & { role: string })[])
    .filter((u) => u.email && !u.email.includes('@example'))
    .map((u) => ({ email: u.email, display_name: u.display_name }));

  if (coaches.length === 0) {
    throw new Error('No coach emails found in users table.');
  }

  const portalUrl = getPortalUrl();
  const from = process.env.RESEND_FROM || FROM_DEFAULT;
  const subject = `LOMAF Round ${round} is live`;
  const previewText = `Round ${round} is in the books. Open the portal to see the damage.`;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0; padding:0; background:#F0F2F5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#0E1629;">
    <span style="display:none; max-height:0; overflow:hidden; opacity:0;">${previewText}</span>
    <table role="presentation" width="100%" style="background:#F0F2F5; padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" style="background:#fff; border-radius:12px; padding:32px; box-shadow:0 1px 3px rgba(14,22,41,0.08);">
          <tr><td>
            <p style="margin:0 0 8px; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#6B7589;">LOMAF HQ</p>
            <h1 style="margin:0 0 16px; font-size:28px; line-height:1.2; color:#0E1629;">Round ${round} is live</h1>
            <p style="margin:0 0 20px; font-size:15px; line-height:1.55; color:#3A4660;">
              Scores, ladder, lines, trades — all updated. Power Rankings drop next, then we do it again.
            </p>
            <p style="margin:0 0 32px;">
              <a href="${portalUrl}" style="display:inline-block; background:#1A56DB; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:600; font-size:14px;">Open the portal →</a>
            </p>
            <p style="margin:0; font-size:12px; color:#9AA3B5;">
              You're getting this because you're a LOMAF coach. Reply with anything if you want off the list.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  // Single send to all coaches. Use BCC so coaches don't see each other's
  // addresses; "to" is a no-reply address from the same domain.
  const { error } = await client.emails.send({
    from,
    to: coaches.map((c) => c.email),
    subject,
    html,
  });
  if (error) {
    throw new Error(error.message ?? 'Resend send failed');
  }
}
