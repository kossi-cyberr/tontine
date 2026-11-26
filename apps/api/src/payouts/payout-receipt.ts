export interface PayoutReceiptData {
  receiptNumber: string;
  executedAt: Date;
  beneficiaryName: string;
  beneficiaryPhone: string;
  accountType: string;
  accountNumber: string;
  groupName: string;
  roundNumber: number;
  grossAmount: number;
  platformFee: number;
  providerFee: number;
  netAmount: number;
  providerReference: string;
}

function pdfEscape(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function textLine(text: string, x: number, y: number, size = 11, bold = false): string {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET\n`;
}

function formatXaf(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} XAF`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Douala',
  }).format(value);
}

/** Justificatif de décaissement (PDF autonome, sans dépendance externe). */
export function buildPayoutReceiptPdf(data: PayoutReceiptData): Buffer {
  const content = [
    textLine('TONTINE', 48, 790, 20, true),
    textLine('Plateforme de tontine en ligne - Cameroun', 48, 772, 9),
    textLine('JUSTIFICATIF DE DECAISSEMENT', 48, 730, 16, true),
    textLine(`Reference N° ${data.receiptNumber}`, 48, 708, 11, true),
    textLine(`Date : ${formatDate(data.executedAt)}`, 48, 690),
    textLine(`Groupe : ${data.groupName}`, 48, 650, 11, true),
    textLine(`Tour : ${data.roundNumber}`, 48, 632),
    textLine(`Beneficiaire : ${data.beneficiaryName} (${data.beneficiaryPhone})`, 48, 614),
    textLine(`Compte de reception : ${data.accountType} ${data.accountNumber}`, 48, 596),
    textLine(`Reference fournisseur : ${data.providerReference}`, 48, 578),
    textLine('----------------------------------------', 48, 548),
    textLine(`Montant brut : ${formatXaf(data.grossAmount)}`, 48, 520, 12),
    textLine(`Frais plateforme : ${formatXaf(data.platformFee)}`, 48, 500, 12),
    textLine(`Frais operateur : ${formatXaf(data.providerFee)}`, 48, 480, 12),
    textLine(`Montant net verse : ${formatXaf(data.netAmount)}`, 48, 456, 13, true),
    textLine('----------------------------------------', 48, 426),
    textLine('Decaissement execute. Les fonds ont ete verses sur le compte indique.', 48, 390, 9),
    textLine('Document genere automatiquement, conservez-le.', 48, 376, 9),
  ].join('');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
