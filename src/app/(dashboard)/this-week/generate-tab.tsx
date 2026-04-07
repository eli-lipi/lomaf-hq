'use client';

import { useState, useEffect } from 'react';
import { Download, Loader2, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

export default function GenerateTab() {
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [slides, setSlides] = useState<(string | null)[]>(Array(12).fill(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkPublished() {
      const { data } = await supabase
        .from('pwrnkgs_rounds')
        .select('round_number, status')
        .eq('status', 'published')
        .order('round_number', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setRoundNumber(data[0].round_number);
        setIsPublished(true);
      }
    }
    checkPublished();
  }, []);

  const generateAll = async () => {
    if (!roundNumber) return;
    setGenerating(true);
    setProgress(0);
    setError(null);
    const newSlides: (string | null)[] = Array(12).fill(null);

    try {
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`/api/carousel/slide/${i}?round=${roundNumber}`);
        if (!res.ok) {
          throw new Error(`Failed to generate slide ${i + 1}`);
        }
        const blob = await res.blob();
        newSlides[i] = URL.createObjectURL(blob);
        setSlides([...newSlides]);
        setProgress(i + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const downloadAll = async () => {
    const { default: JSZip } = await import('jszip');
    const { saveAs } = await import('file-saver');
    const zip = new JSZip();

    for (let i = 0; i < slides.length; i++) {
      if (!slides[i]) continue;
      const response = await fetch(slides[i]!);
      const blob = await response.blob();
      const name = i === 0 ? 'slide-01-preview.png' : i === 11 ? 'slide-12-summary.png' : `slide-${String(i + 1).padStart(2, '0')}-rank${11 - i}.png`;
      zip.file(name, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `r${roundNumber}-pwrnkgs.zip`);
  };

  const downloadSlide = (index: number) => {
    if (!slides[index]) return;
    const a = document.createElement('a');
    a.href = slides[index]!;
    const name = index === 0 ? 'slide-01-preview.png' : index === 11 ? 'slide-12-summary.png' : `slide-${String(index + 1).padStart(2, '0')}-rank${11 - index}.png`;
    a.download = name;
    a.click();
  };

  if (!isPublished) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Publish your rankings first to generate carousel images.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="bg-primary/10 text-primary font-bold px-3 py-1 rounded text-sm">R{roundNumber}</span>
        </div>
        <div className="flex gap-3">
          <button
            onClick={generateAll}
            disabled={generating}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              generating
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating ({progress}/12)
              </>
            ) : (
              <>
                <ImageIcon size={16} />
                Generate All
              </>
            )}
          </button>
          {slides.some((s) => s !== null) && (
            <button
              onClick={downloadAll}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-card border border-border hover:bg-muted/50 transition-colors"
            >
              <Download size={16} />
              Download ZIP
            </button>
          )}
        </div>
      </div>

      {/* Slide grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square bg-card border border-border rounded-lg overflow-hidden relative group cursor-pointer"
            onClick={() => downloadSlide(i)}
          >
            {slides[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={slides[i]!} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                <ImageIcon size={24} className="mb-2 opacity-30" />
                <span className="text-xs">
                  {i === 0 ? 'Preview' : i === 11 ? 'Summary' : `#${11 - i}`}
                </span>
              </div>
            )}
            {slides[i] && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Download size={24} className="text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}
    </div>
  );
}
