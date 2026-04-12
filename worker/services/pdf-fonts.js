import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";

import { PDF_BODY_FONT_BYTES, PDF_DISPLAY_FONT_BYTES } from "./pdf-font-data.js";

export async function embedSiteOpsPdfFonts(pdfDoc) {
  try {
    pdfDoc.registerFontkit(fontkit);
    const [titleFont, bodyFont] = await Promise.all([
      pdfDoc.embedFont(PDF_DISPLAY_FONT_BYTES, { subset: true }),
      pdfDoc.embedFont(PDF_BODY_FONT_BYTES, { subset: true }),
    ]);
    return { titleFont, bodyFont, custom: true };
  } catch (error) {
    console.warn("siteops_pdf_font_embed_failed", error);
    const [titleFont, bodyFont] = await Promise.all([
      pdfDoc.embedFont(StandardFonts.HelveticaBold),
      pdfDoc.embedFont(StandardFonts.Helvetica),
    ]);
    return { titleFont, bodyFont, custom: false };
  }
}
