'use client';

import UploadContent from './upload-content';

export default function DataUploadPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Data Upload</h1>
        <p className="text-muted-foreground text-sm mt-1">Upload weekly CSV exports to update league data</p>
      </div>
      <UploadContent />
    </div>
  );
}
