/** @type {import('next').NextConfig} */
const nextConfig = {
  // Автономная сборка для Docker (§5.9 переезд на инно-сервер). На Vercel игнорируется.
  output: 'standalone',
}
module.exports = nextConfig
