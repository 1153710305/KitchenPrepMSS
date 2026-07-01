import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // 1. 将 React 核心基础框架独立分包
              if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
                return 'vendor-react';
              }
              // 2. 将大型图表组件 Recharts 及其 d3 绘制引擎独立分包
              if (id.includes('recharts') || id.includes('d3')) {
                return 'vendor-charts';
              }
              // 3. 将大型拼音翻译大底库 pinyin-pro 独立分包
              if (id.includes('pinyin-pro')) {
                return 'vendor-pinyin';
              }
            }
          }
        }
      },
      chunkSizeWarningLimit: 1000
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/data/**']
      },
    },
  };
});
