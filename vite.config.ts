import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/chopsticks-web',
  define: {
    'process.env.LOG_LEVEL': JSON.stringify('trace'),
    'process.env.VERBOSE_LOG': JSON.stringify('true'),
  },
})
