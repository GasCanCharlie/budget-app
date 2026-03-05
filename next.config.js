/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
