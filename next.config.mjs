/** @type {import('next').NextConfig} */
const nextConfig = {
  // Roda dentro da rede local da loja; sem cabeçalho de versão.
  poweredByHeader: false,
  agentRules: false,
  // esconde o botão "N" do Next no modo de desenvolvimento (cobria o canto do menu)
  devIndicators: false,
};

export default nextConfig;
