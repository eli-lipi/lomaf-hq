import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fmpuuxxbtdotyyrofneg.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    // v13.4 — force deep imports for icon libraries with broad
    // named-export surfaces. Next.js rewrites
    //   import { X, Y } from 'lucide-react'
    // into per-icon deep imports at build time, sidestepping any
    // tree-shaking misses in the bundler. lucide-react in particular
    // ships every icon in a single barrel; without this, the whole
    // ~30MB package walks into the page bundle.
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
