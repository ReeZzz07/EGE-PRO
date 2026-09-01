// Экспорт текстового документа (оферта/политика) в PDF на клиенте — без похода на бэкенд.
// jsPDF со встроенными шрифтами (Helvetica и т.п.) не умеет кириллицу — используем PT Sans,
// сконвертированный из @openfonts/pt-sans_cyrillic (MIT) в base64 TTF через wawoff2 и сохранённый
// в src/lib/generated/. Шрифт грузится динамическим импортом (вместе с самим jsPDF), чтобы ~190КБ
// base64-данных шрифта не попадали в основной бандл — только при реальном клике «Скачать PDF».
export async function downloadTextAsPdf(title: string, content: string, filename: string): Promise<void> {
  const [{ jsPDF }, { PT_SANS_REGULAR_BASE64 }, { PT_SANS_BOLD_BASE64 }] = await Promise.all([
    import("jspdf"),
    import("./generated/ptSansRegular"),
    import("./generated/ptSansBold"),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.addFileToVFS("PTSans-Regular.ttf", PT_SANS_REGULAR_BASE64);
  doc.addFont("PTSans-Regular.ttf", "PTSans", "normal");
  doc.addFileToVFS("PTSans-Bold.ttf", PT_SANS_BOLD_BASE64);
  doc.addFont("PTSans-Bold.ttf", "PTSans", "bold");

  const marginX = 56;
  const marginTop = 64;
  const marginBottom = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - marginX * 2;
  let y = marginTop;

  doc.setFont("PTSans", "bold");
  doc.setFontSize(16);
  for (const line of doc.splitTextToSize(title, usableWidth) as string[]) {
    doc.text(line, marginX, y);
    y += 22;
  }
  y += 12;

  doc.setFont("PTSans", "normal");
  doc.setFontSize(11);
  const lineHeight = 15;

  for (const paragraph of content.split("\n")) {
    if (paragraph.trim() === "") {
      y += lineHeight * 0.6;
      continue;
    }
    for (const line of doc.splitTextToSize(paragraph, usableWidth) as string[]) {
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(line, marginX, y);
      y += lineHeight;
    }
  }

  doc.save(filename);
}
