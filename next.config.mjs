/** @type {import('next').NextConfig} */
const nextConfig = {
  // Roda dentro da rede local da loja; sem cabeçalho de versão.
  poweredByHeader: false,
  agentRules: false,
  // esconde o botão "N" do Next no modo de desenvolvimento (cobria o canto do menu)
  devIndicators: false,
  // a rota que reinicia a demo online aplica as migrações: leva a pasta drizzle/ junto no deploy
  outputFileTracingIncludes: { "/api/demo/resetar": ["./drizzle/**/*"] },
  // XML da NF-e e PDF/foto da nota lida por IA são enviados por server action (padrão do Next: 1 MB)
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
