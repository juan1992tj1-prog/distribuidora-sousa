"use client";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { CameraLeitor } from "./CameraLeitor";

/**
 * Campo que recebe o leitor USB/Bluetooth (que "digita" o código e aperta Enter)
 * e tem um botão para usar a câmera do celular.
 *
 * Leitores USB normalmente não conseguem "digitar" o separador GS1 (FNC1).
 * Configure o leitor para enviar "~" no lugar dele — aqui convertemos de volta.
 */
const SEPARADOR_GS = process.env.NEXT_PUBLIC_SEPARADOR_GS ?? "~";

export type LeitorRef = { focar: () => void };

export const LeitorCodigo = forwardRef<
  LeitorRef,
  { onLeitura: (codigo: string) => void; placeholder?: string; desabilitado?: boolean }
>(function LeitorCodigo({ onLeitura, placeholder, desabilitado }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const [valor, setValor] = useState("");
  const [camera, setCamera] = useState(false);

  useImperativeHandle(ref, () => ({ focar: () => input.current?.focus() }));

  const enviar = useCallback(
    (bruto: string) => {
      const codigo = bruto.split(SEPARADOR_GS).join("\x1d").trim();
      if (codigo) onLeitura(codigo);
    },
    [onLeitura],
  );

  const daCamera = useCallback(
    (codigo: string) => {
      setCamera(false);
      enviar(codigo);
      setTimeout(() => input.current?.focus(), 50);
    },
    [enviar],
  );

  return (
    <div className="flex gap-2">
      <input
        ref={input}
        value={valor}
        disabled={desabilitado}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            enviar(valor);
            setValor("");
          }
        }}
        autoFocus
        autoComplete="off"
        inputMode="text"
        placeholder={placeholder ?? "Bipe o código ou digite e tecle Enter"}
        className="campo mt-0 text-lg"
      />
      <button type="button" className="btn-neutro shrink-0" onClick={() => setCamera(true)} title="Ler com a câmera">
        📷
      </button>
      {camera && <CameraLeitor onLeitura={daCamera} onFechar={() => setCamera(false)} />}
    </div>
  );
});
