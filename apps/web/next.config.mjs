import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// En développement, le web est lancé depuis apps/web : on lit le .env du monorepo
// pour exposer le code OTP fixe à l'écran de vérification (jamais en production).
loadEnv({ path: resolve(process.cwd(), '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_URL: process.env.API_URL ?? 'http://localhost:3051',
    // Jamais de code OTP fixe dans un bundle de production, même si le .env
    // de build le contient encore.
    NEXT_PUBLIC_DEV_OTP_CODE:
      process.env.NODE_ENV === 'production' ? '' : (process.env.OTP_FIXED_CODE ?? ''),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
