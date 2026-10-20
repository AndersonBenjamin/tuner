import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev:celular` abre o servidor na rede local com HTTPS,
// porque o navegador do celular só libera o microfone em conexão segura.
export default defineConfig(async ({ mode }) => {
  const plugins = [react()];
  if (mode === 'celular') {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }
  return {
    plugins,
    server: mode === 'celular' ? { host: true } : {},
  };
});
