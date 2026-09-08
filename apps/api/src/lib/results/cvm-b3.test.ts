import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  latestCalendarDocuments,
  parseCvmCalendarText,
  parseCvmManifestArchive,
  selectNextResult,
} from "./cvm-b3";

const BB_CALENDAR = `
CALENDÁRIO ANUAL DE EVENTOS CORPORATIVOS
Denominação Social: BCO BRASIL S.A.
Data de referência: 2026
Demonstrações Financeiras Anuais Completas e Demonstrações Financeiras Padronizadas
– DFP relativas ao exercício social findo em 31/12/2025   12/02/2026
Formulário de Referência, relativo ao exercício social em curso   29/05/2026
Informações Trimestrais – ITR
Referentes ao 1º trimestre   13/05/2026
Referentes ao 2º trimestre   12/08/2026
Referentes ao 3º trimestre   11/11/2026
Assembleia Geral Ordinária
`;

describe("parseCvmCalendarText", () => {
  it("parses accented DFP and ITR sections from a real calendar layout", () => {
    expect(parseCvmCalendarText(BB_CALENDAR, 2026)).toEqual([
      { date: "2026-02-12", period: "FY25" },
      { date: "2026-05-13", period: "1Q26" },
      { date: "2026-08-12", period: "2Q26" },
      { date: "2026-11-11", period: "3Q26" },
    ]);
  });

  it("ignores invalid dates and removes duplicate period/date pairs", () => {
    const text = `
      Demonstrações Financeiras Anuais – DFP 31/02/2026
      Informações Trimestrais - ITR
      Referente ao 1o trimestre 30/04/2026
      Referente ao 1º trimestre 30/04/2026
      Referente ao 2º trimestre 32/08/2026
      Assembleia Geral
    `;

    expect(parseCvmCalendarText(text, 2026)).toEqual([
      { date: "2026-04-30", period: "1Q26" },
    ]);
  });
});

describe("selectNextResult", () => {
  it("selects the nearest non-past event independent of input order", () => {
    expect(
      selectNextResult(
        [
          { date: "2026-11-11", period: "3Q26" },
          { date: "2026-02-12", period: "FY25" },
          { date: "2026-08-12", period: "2Q26" },
        ],
        "2026-06-01",
      ),
    ).toEqual({ date: "2026-08-12", period: "2Q26" });
  });
});

describe("latestCalendarDocuments", () => {
  it("uses the latest version and keeps a current calendar delivered in the previous year", () => {
    const rows = [
      {
        codeCvm: "1023",
        referenceYear: 2026,
        deliveredAt: "2025-12-10T18:00:00",
        version: 1,
        downloadUrl: "older.pdf",
      },
      {
        codeCvm: "1023",
        referenceYear: 2026,
        deliveredAt: "2025-12-10T18:00:00",
        version: 2,
        downloadUrl: "current.pdf",
      },
      {
        codeCvm: "9999",
        referenceYear: 2026,
        deliveredAt: "2026-01-01T00:00:00",
        version: 9,
        downloadUrl: "other-company.pdf",
      },
    ];

    expect(latestCalendarDocuments(rows, "1023", 2026)).toEqual([rows[1]]);
  });
});

describe("parseCvmManifestArchive", () => {
  it("tolerates malformed quotes in unrelated rows from the official export", () => {
    const header = [
      "Codigo_CVM",
      "Data_Referencia",
      "Categoria",
      "Data_Entrega",
      "Versao",
      "Link_Download",
    ].join(";");
    const malformed =
      '1023;2026-12-31;Assunto livre ("CVM");2026-01-01;1;https://example.com/ignored';
    const calendar = [
      "1023",
      "2026-12-31",
      "Calendário de Eventos Corporativos",
      "2025-12-10",
      "2",
      "https://www.rad.cvm.gov.br/calendar.pdf",
    ].join(";");
    const archive = zipSync({
      "ipe.csv": new Uint8Array(
        Buffer.from(`${header}\n${malformed}\n${calendar}\n`, "latin1"),
      ),
    });

    expect(parseCvmManifestArchive(archive)).toEqual([
      {
        codeCvm: "1023",
        referenceYear: 2026,
        deliveredAt: "2025-12-10",
        version: 2,
        downloadUrl: "https://www.rad.cvm.gov.br/calendar.pdf",
      },
    ]);
  });
});
