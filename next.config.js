/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Node.js-only packages out of the webpack bundle
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  // Allow fetching from Google Sheets
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
