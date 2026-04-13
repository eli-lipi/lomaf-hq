import { redirect } from 'next/navigation';

// Data Upload has moved into Settings as a tab. This route is preserved
// only as a redirect for bookmarks and the upload-content.tsx file
// (re-used by the new DataUploadTab component).
export default function UploadPage() {
  redirect('/settings?tab=upload');
}
