"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Lê código de barras / QR / DataMatrix pela câmera do celular.
 * Precisa de HTTPS (o Caddy cuida disso na rede da loja).
 */
export function CameraLeitor({ onLeitura, onFechar }: { onLeitura: (codigo: string) => void; onFechar: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const idRef = useRef(`camera-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let leitor: { stop: () => Promise<void>; isScanning: boolean } | null = null;
    let ativo = true;
    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import("html5-qrcode");
        if (!ativo) return;
        const h = new Html5Qrcode(idRef.current, {
          verbose: false,
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.ITF, F.CODE_128, F.QR_CODE, F.DATA_MATRIX],
          useBarCodeDetectorIfSupported: true,
        });
        leitor = h;
        await h.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 180 } },
          (texto) => {
            if (!ativo) return;
            ativo = false;
            navigator.vibrate?.(80);
            h.stop().finally(() => onLeitura(texto));
          },
          () => {},
        );
      } catch (e) {
        setErro(
          window.isSecureContext
            ? "Não foi possível abrir a câmera. Verifique a permissão do navegador."
            : "A câmera só funciona em HTTPS. Acesse o sistema pelo endereço https:// da loja.",
        );
        console.error(e);
      }
    })();
    return () => {
      ativo = false;
      if (leitor?.isScanning) leitor.stop().catch(() => {});
    };
  }, [onLeitura]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-3">
        <div id={idRef.current} className="w-full overflow-hidden rounded-lg" />
        {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
        <button type="button" onClick={onFechar} className="btn-neutro mt-3 w-full">
          Fechar câmera
        </button>
      </div>
    </div>
  );
}
