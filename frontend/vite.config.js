import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'chess': ['chess.js', 'react-chessboard'],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'socket.io-client'],
        }
      }
    }
  }
})
