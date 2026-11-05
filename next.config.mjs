/** @type {import('next').NextConfig} */
const nextConfig = {
  // Roda dentro da rede local da loja; sem cabeçalho de versão.
  poweredByHeader: false,
  agentRules: false,
  // esconde o botão "N" do Next no modo de desenvolvimento (cobria o canto do menu)
  devIndicators: false,
  // a rota que reinicia a demo online aplica as migrações: leva a pasta drizzle/ junto no deploy
  outputFileTracingIncludes: { "/api/demo/resetar": ["./drizzle/**/*"] },
};

export default nextConfig;
