// Real Office Open XML builders — .xlsx (spreadsheet), .docx (document), .pptx (deck).
// Pure Node, zero dependencies. Colours and fonts come from design.md tokens, so the
// binaries are brand-conformant by construction (gate D7 verifies). The brand marker is
// embedded in docProps/core.xml so a reader can confirm provenance.
import { zip } from './zip.mjs';
import { MARKER } from '../../gates/brand.mjs';

const MARK = `${MARKER}@v1`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// token helpers — design.md value '#1F4DB8' → OOXML 'FF1F4DB8' (ARGB) / '1F4DB8' (RGB).
const rgb = (t, name, fb) => (t(name, fb) || '#000000').replace('#', '').toUpperCase();
const argb = (t, name, fb) => 'FF' + rgb(t, name, fb);
const firstFont = (t) => (t('font.family.sans', 'Arial').split(',')[0] || 'Arial').replace(/["']/g, '').trim();

function core(title) {
  return `${XMLH}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${esc(title)}</dc:title>` +
    `<dc:description>${MARK}</dc:description>` +
    `</cp:coreProperties>`;
}
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ─────────────────────────────────────────────────────────────────────────── XLSX (#4)
function colLetter(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const STATUS_XF = { header: 1, ok: 2, warn: 3, danger: 4 };

/** spec: { title?, sheetName?, columns:[string], rows:[[ string | {v,status} ]] } */
export function buildXlsx(spec, t) {
  const sheetName = (spec.sheetName || 'Sheet1').slice(0, 31);
  const cell = (ref, val, xf) => {
    const s = xf ? ` s="${xf}"` : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
  };
  const rowsXml = [];
  const header = `<row r="1">${(spec.columns || []).map((h, c) => cell(colLetter(c) + '1', h, STATUS_XF.header)).join('')}</row>`;
  rowsXml.push(header);
  (spec.rows || []).forEach((row, ri) => {
    const r = ri + 2;
    const cells = row.map((c, ci) => {
      const v = c && typeof c === 'object' ? c.v : c;
      const xf = c && typeof c === 'object' && c.status ? STATUS_XF[c.status] : 0;
      return cell(colLetter(ci) + r, v, xf);
    }).join('');
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  });

  const styles = `${XMLH}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="${esc(firstFont(t))}"/></font>` +
    `<font><b/><color rgb="${argb(t, 'color.brand.primary-ink', '#FFFFFF')}"/><sz val="11"/><name val="${esc(firstFont(t))}"/></font></fonts>` +
    `<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(t, 'color.brand.primary', '#1F4DB8')}"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(t, 'color.brand.accent', '#0E9F6E')}"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(t, 'color.status.warn', '#B8860B')}"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(t, 'color.status.danger', '#B42318')}"/></patternFill></fill></fills>` +
    `<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

  const sheet = `${XMLH}<!-- ${MARK} --><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join('')}</sheetData></worksheet>`;

  return zip([
    { name: '[Content_Types].xml', data: `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: core(spec.title || sheetName) },
    { name: 'xl/workbook.xml', data: `${XMLH}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OD}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OD}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────── DOCX
function docRun(text, { color, bold, font, sz } = {}) {
  const rpr = [
    font ? `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}"/>` : '',
    bold ? '<w:b/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    sz ? `<w:sz w:val="${sz}"/>` : '',
  ].join('');
  return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
const docP = (inner, { shd } = {}) => `<w:p>${shd ? `<w:pPr><w:shd w:val="clear" w:fill="${shd}"/></w:pPr>` : ''}${inner}</w:p>`;

/** spec: { title, subtitle?, sections:[{heading, blocks:[{p}|{list}|{table}|{note}]}] } */
export function buildDocx(spec, t) {
  const font = firstFont(t);
  const brand = rgb(t, 'color.brand.primary', '#1F4DB8');
  const ink = rgb(t, 'color.ink.strong', '#0B1221');
  const muted = rgb(t, 'color.ink.muted', '#5A6473');
  const onBrand = rgb(t, 'color.brand.primary-ink', '#FFFFFF');
  const border = rgb(t, 'color.border.subtle', '#E2E6EC');
  const body = [];

  body.push(docP(docRun(spec.title, { color: brand, bold: true, font, sz: '40' })));
  if (spec.subtitle) body.push(docP(docRun(spec.subtitle, { color: muted, font, sz: '24' })));

  const cell = (text, { head } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? `<w:shd w:val="clear" w:fill="${brand}"/>` : ''}<w:tcBorders><w:top w:val="single" w:sz="4" w:color="${border}"/><w:bottom w:val="single" w:sz="4" w:color="${border}"/><w:left w:val="single" w:sz="4" w:color="${border}"/><w:right w:val="single" w:sz="4" w:color="${border}"/></w:tcBorders></w:tcPr>` +
    docP(docRun(text, { color: head ? onBrand : ink, bold: !!head, font, sz: '20' })) + `</w:tc>`;

  for (const sec of spec.sections || []) {
    if (sec.heading) body.push(docP(docRun(sec.heading, { color: brand, bold: true, font, sz: '28' })));
    for (const b of sec.blocks || []) {
      if (b.p) body.push(docP(docRun(b.p, { color: ink, font, sz: '22' })));
      else if (b.note) body.push(docP(docRun(b.note, { color: muted, font, sz: '20' })));
      else if (b.list) for (const it of b.list) body.push(docP(docRun('• ' + it, { color: ink, font, sz: '22' })));
      else if (b.table) {
        const rows = [`<w:tr>${b.table.headers.map((h) => cell(h, { head: true })).join('')}</w:tr>`];
        for (const r of b.table.rows) rows.push(`<w:tr>${r.map((c) => cell(c)).join('')}</w:tr>`);
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="${border}"/><w:bottom w:val="single" w:sz="4" w:color="${border}"/><w:insideH w:val="single" w:sz="4" w:color="${border}"/><w:insideV w:val="single" w:sz="4" w:color="${border}"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl>`);
      }
    }
  }

  const document = `${XMLH}<!-- ${MARK} --><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  return zip([
    { name: '[Content_Types].xml', data: `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: core(spec.title || 'Document') },
    { name: 'word/document.xml', data: document },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────── PPTX
const PPTX_THEME = `${XMLH}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const SP_TREE_EMPTY = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`;

function textBox(id, name, x, y, cx, cy, paras) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}
function rect(id, x, y, cx, cy, fillHex) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}
const para = (runs, { align } = {}) => `<a:p>${align ? `<a:pPr algn="${align}"/>` : ''}${runs}</a:p>`;
const run = (text, hex, sz, bold) => `<a:r><a:rPr lang="en-US" sz="${sz}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:latin typeface="%FONT%"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;

/** spec: { title, subtitle?, slides:[{title, kicker?, bullets:[string], note?}] } */
export function buildPptx(spec, t) {
  const font = firstFont(t);
  const brand = rgb(t, 'color.brand.primary', '#1F4DB8');
  const ink = rgb(t, 'color.ink.strong', '#0B1221');
  const muted = rgb(t, 'color.ink.muted', '#5A6473');
  const warn = rgb(t, 'color.status.warn', '#B8860B');
  const onBrand = rgb(t, 'color.brand.primary-ink', '#FFFFFF');
  const W = 12192000, H = 6858000; // 16:9 EMU

  const allSlides = [{ title: spec.title, kicker: spec.subtitle, bullets: [], cover: true }, ...(spec.slides || [])];
  const slideParts = allSlides.map((s, i) => {
    const banner = rect(2, 0, 0, W, 274320, warn) +
      textBox(3, 'demo', 152400, 30480, W - 304800, 213360, para(run('DEMO — synthetic, non-production', onBrand, '1000', false)));
    let sp = SP_TREE_EMPTY + banner;
    if (s.cover) {
      sp += textBox(4, 'title', 685800, 2438400, W - 1371600, 1371600, para(run(s.title, brand, '4000', true)));
      if (s.kicker) sp += textBox(5, 'sub', 685800, 3886200, W - 1371600, 685800, para(run(s.kicker, muted, '2000', false)));
    } else {
      if (s.kicker) sp += textBox(4, 'kicker', 685800, 548640, W - 1371600, 457200, para(run(s.kicker.toUpperCase(), brand, '1400', true)));
      sp += textBox(5, 'title', 685800, 990600, W - 1371600, 990600, para(run(s.title, ink, '3200', true)));
      const bullets = (s.bullets || []).map((b) => para(run('•  ' + b, ink, '2000', false))).join('');
      sp += textBox(6, 'body', 685800, 2133600, W - 1371600, 3200400, bullets || para(run('', ink, '2000', false)));
      if (s.note) sp += textBox(7, 'note', 685800, 5715000, W - 1371600, 685800, para(run(s.note, muted, '1400', false)));
    }
    const xml = `${XMLH}<!-- ${MARK} --><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OD}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${sp}</p:spTree></p:cSld></p:sld>`.replace(/%FONT%/g, esc(font));
    return { idx: i + 1, xml };
  });

  const slideIds = slideParts.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  const presentation = `${XMLH}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OD}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presRels = `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rIdM" Type="${OD}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    slideParts.map((s) => `<Relationship Id="rId${s.idx}" Type="${OD}/slide" Target="slides/slide${s.idx}.xml"/>`).join('') +
    `<Relationship Id="rIdT" Type="${OD}/theme" Target="theme/theme1.xml"/></Relationships>`;

  const master = `${XMLH}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OD}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SP_TREE_EMPTY}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  const masterRels = `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdT" Type="${OD}/theme" Target="../theme/theme1.xml"/></Relationships>`;
  const layout = `${XMLH}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OD}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${SP_TREE_EMPTY}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const layoutRels = `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

  const ctypes = `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    slideParts.map((s) => `<Override PartName="/ppt/slides/slide${s.idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const entries = [
    { name: '[Content_Types].xml', data: ctypes },
    { name: '_rels/.rels', data: `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: core(spec.title || 'Deck') },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRels },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRels },
    { name: 'ppt/theme/theme1.xml', data: PPTX_THEME },
  ];
  for (const s of slideParts) {
    entries.push({ name: `ppt/slides/slide${s.idx}.xml`, data: s.xml });
    entries.push({ name: `ppt/slides/_rels/slide${s.idx}.xml.rels`, data: `${XMLH}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OD}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>` });
  }
  return zip(entries);
}

export const BUILDERS = { xlsx: buildXlsx, docx: buildDocx, pptx: buildPptx };

/** Content parts whose colours D7 should hold to the token allow-list (skip framework
 *  boilerplate like the theme / master / layout, which carry standard Office colours). */
export const CONTENT_PARTS = {
  xlsx: (n) => n === 'xl/styles.xml' || n.startsWith('xl/worksheets/'),
  docx: (n) => n === 'word/document.xml',
  pptx: (n) => n.startsWith('ppt/slides/slide'),
};
