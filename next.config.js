/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'bcryptjs', 'openai'],
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
