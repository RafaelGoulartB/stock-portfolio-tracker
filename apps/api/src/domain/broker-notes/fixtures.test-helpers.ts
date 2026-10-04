import { groupLines, type PdfPage, type PdfTextItem } from "../../lib/pdf-text";

type Cell = [x: number, text: string];

/**
 * A synthetic PDF page: each row is a baseline with positioned cells, the
 * way PDF.js reports them. Widths approximate a 4 pt glyph.
 */
export function page(number: number, rows: [y: number, ...cells: Cell[]][]) {
  const items: PdfTextItem[] = rows.flatMap(([y, ...cells]) =>
    cells.map(([x, text]) => ({ x, y, width: text.length * 4, text })),
  );

  return { number, lines: groupLines(items) } satisfies PdfPage;
}

type B3Trade = {
  side: "C" | "V";
  market?: string;
  spec: Cell[];
  obs?: string;
  quantity: string;
  price: string;
  value: string;
};

/** Inter DTVM's SINACOR layout, positions taken from real notes. */
export function sinacorPage({
  noteNumber = "43172350",
  tradeDate = "01/09/2026",
  trades,
  summary,
}: {
  noteNumber?: string;
  tradeDate?: string;
  trades: B3Trade[];
  summary: [y: number, ...cells: Cell[]][];
}): PdfPage {
  return page(1, [
    [37, [238, "NOTA DE CORRETAGEM"]],
    [53, [427, "Nr. nota"], [476, "Folha"], [522, "Data pregão"]],
    [65, [434, noteNumber], [496, "1"], [530, tradeDate]],
    [79, [195, "INTER DTVM LTDA."]],
    [242, [22, "Banco"], [62, "Agência"], [116, "Conta corrente"]],
    [255, [34, "077"], [93, "00019"], [138, "999999999"]],
    [266, [21, "Negócios realizados"]],
    [
      277,
      [24, "Q"],
      [36, "Negociação"],
      [97, "C/V"],
      [113, "Tipo mercado"],
      [178, "Prazo"],
      [218, "Especificação do titulo"],
      [354, "Obs (*)"],
      [398, "Quantidade"],
      [437, "Preço/Ajuste"],
      [486, "Valor operação/Ajuste"],
      [560, "D/C"],
    ],
    ...trades.map((trade, index): [number, ...Cell[]] => [
      290 + index * 14,
      [37, "Bovespa"],
      [99, trade.side],
      [114, trade.market ?? "FRA"],
      ...trade.spec,
      ...(trade.obs ? ([[360, trade.obs]] as Cell[]) : []),
      [424, trade.quantity],
      [464, trade.price],
      [524, trade.value],
      [562, trade.side === "C" ? "D" : "C"],
    ]),
    [
      471,
      [22, "Resumo dos negócios"],
      [300, "Resumo financeiro"],
      [558, "D/C"],
    ],
    ...summary,
  ]);
}
