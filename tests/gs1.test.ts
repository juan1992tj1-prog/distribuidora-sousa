import { describe, expect, it } from "vitest";
import { dataGs1ParaIso, gtinValido, lerCodigo, variacoesGtin } from "@/lib/gs1";
import { validadeDigitada, paraCentavos } from "@/lib/formato";

describe("leitura de códigos", () => {
  it("EAN-13 comum", () => {
    expect(lerCodigo("7891234567895\n")).toMatchObject({ gtin: "7891234567895", estruturado: false });
  });
  it("GS1 com FNC1 (DataMatrix / GS1-128)", () => {
    const r = lerCodigo("]d20107891234567895172712311" + "0L123AB");
    expect(r).toMatchObject({ gtin: "07891234567895", validade: "2027-12-31", lote: "L123AB", estruturado: true });
  });
  it("lote antes da validade, separado por GS", () => {
    const r = lerCodigo("010789123456789510LOTE9\x1d17270600");
    expect(r).toMatchObject({ lote: "LOTE9", validade: "2027-06-30" });
  });
  it("formato com parênteses", () => {
    expect(lerCodigo("(01)07891234567895(17)270115(10)A1")).toMatchObject({ validade: "2027-01-15", lote: "A1" });
  });
  it("GS1 Digital Link (QR)", () => {
    const r = lerCodigo("https://id.exemplo.com.br/01/07891234567895/10/L77?17=280229");
    expect(r).toMatchObject({ gtin: "07891234567895", lote: "L77", validade: "2028-02-29" });
  });
  it("datas e GTIN", () => {
    expect(dataGs1ParaIso("270200")).toBe("2027-02-28");
    expect(dataGs1ParaIso("271332")).toBeUndefined();
    expect(gtinValido("7891234567895")).toBe(true);
    expect(gtinValido("7891234567890")).toBe(false);
    expect(variacoesGtin("07891234567895")).toContain("7891234567895");
  });
  it("digitação rápida de validade e dinheiro", () => {
    expect(validadeDigitada("311226")).toBe("2026-12-31");
    expect(validadeDigitada("310226")).toBeNull();
    expect(paraCentavos("1.234,56")).toBe(123456);
    expect(paraCentavos("4.5")).toBe(450);
  });
});
