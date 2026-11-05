/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.LOCAL_SUPABASE === 'true' ? '.next-local' : '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  serverExternalPackages: ['pdfjs-dist'],
  webpack: (config) => {
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    return config
  },
}

export default nextConfig
