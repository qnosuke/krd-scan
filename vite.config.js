import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages ではリポジトリ名がパスの先頭に付く
const BASE = '/krd-scan/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'KRD scan',
        short_name: 'KRD scan',
        description: 'オムロン KRD-203 の測定値をカメラで読み取ってCSV記録',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f3f2ee',
        theme_color: '#f3f2ee',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
}));
