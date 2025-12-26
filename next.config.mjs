/**
 * Next.js Configuration (App Router Starter)
 *
 * Purpose:
 * - Configure core Next.js runtime behavior for this starter template.
 *
 * Notes:
 * - App Router is enabled by default in Next.js 14 via the `app` directory.
 * - Extend this file as needed for redirects, rewrites, headers, etc.
 * - Standalone output enabled for Docker deployment
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only use standalone output in production (for Docker production builds)
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  experimental: {
    outputFileTracingIncludes: {
      '/api/**/*': ['./orchestrator/**/*']
    }
  },
  // Enable webpack polling for Docker file watching
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000, // Check for changes every second (for Docker volume mounts)
        aggregateTimeout: 300, // Delay before rebuilding
        ignored: ['**/node_modules', '**/.git', '**/.next'],
      };
    }
    return config;
  },
};

export default nextConfig;
