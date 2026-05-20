import { redirect } from 'next/navigation';
import { getCurrentUser, isRealAdmin } from '@/lib/auth';
import UploadContent from './upload-content';

export const dynamic = 'force-dynamic';

/**
 * /upload — admin-only direct uploader.
 *
 * History: pre-v14 this route was a redirect to /settings?tab=upload
 * (per v12.2 the uploader had been folded into the round-advance
 * ceremony inside /round-control). But Settings then dropped the
 * 'upload' tab from its TABS array, so the redirect dead-ended in
 * the Coach Photos tab.
 *
 * v14 restores this as a real page so admins can refresh the Player
 * Directory (or any other CSV) outside the ceremony — without
 * having to advance the round. /round-control still embeds the same
 * UploadContent for the ceremony flow via its `controlledTargetRound`
 * prop, so there's one uploader implementation with two surfaces.
 */
export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!isRealAdmin(user)) {
    redirect('/');
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Data Upload</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Refresh the canonical CSVs (Players directory, Points Grid, Lineups, Matchups, Teams, Draft)
        outside the round-advance ceremony. Round Control still embeds this same uploader for the
        weekly ceremony.
      </p>
      <UploadContent />
    </div>
  );
}
