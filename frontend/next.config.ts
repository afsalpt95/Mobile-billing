import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Hosted setup: set BACKEND_URL (e.g. https://my-pos-api.vercel.app) and NEXT_PUBLIC_API_URL=/api/v1.
 * The browser then calls the API on the frontend's own domain and Next forwards it to the backend, so the
 * httpOnly login cookie stays first-party (browsers drop cookies sent between two different *.vercel.app sites).
 */
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This app is standalone; do not let Next infer a parent folder as the workspace root.
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    return backendUrl ? [{ source: '/api/v1/:path*', destination: `${backendUrl}/api/v1/:path*` }] : [];
  },
};

export default nextConfig;
