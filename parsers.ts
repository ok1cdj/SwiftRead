
import JSZip from 'jszip';

/**
 * Dekóduje buffer na string, zkouší UTF-8 a následně Windows-1250 jako fallback.
 */
export const decodeBuffer = (buffer: ArrayBuffer): string => {
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8Decoder.decode(buffer);
  } catch (e) {
    const cp1250Decoder = new TextDecoder('windows-1250');
    return cp1250Decoder.decode(buffer);
  }
};

/**
 * Pomocná funkce pro dekompresi PalmDOC (používáno v MOBI).
 */
const decompressPalmDoc = (data: Uint8Array): Uint8Array => {
  const output = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i++];
    if (c === 0) {
      output.push(0);
    } else if (c >= 1 && c <= 8) {
      for (let j = 0; j < c && i < data.length; j++) output.push(data[i++]);
    } else if (c <= 0x7f) {
      output.push(c);
    } else if (c >= 0xc0) {
      output.push(32); // mezera
      output.push(c ^ 0x80);
    } else if (c >= 0x80) {
      const next = data[i++];
      const distance = (((c & 0x3f) << 8) | next) >> 3;
      const length = (next & 0x07) + 3;
      const startPos = output.length - distance;
      if (startPos >= 0) {
        for (let j = 0; j < length; j++) {
          output.push(output[startPos + j]);
        }
      }
    }
  }
  return new Uint8Array(output);
};

/**
 * Parsuje binární MOBI soubor.
 */
export const parseMobi = async (data: ArrayBuffer): Promise<string> => {
  const view = new DataView(data);
  const recordCount = view.getUint16(76);
  const offsets: number[] = [];
  for (let i = 0; i < recordCount; i++) {
    offsets.push(view.getUint32(78 + i * 8));
  }

  const offset0 = offsets[0];
  const compression = view.getUint16(offset0);
  const textRecordCount = view.getUint16(offset0 + 8);
  
  let fullText = "";
  const decoder = new TextDecoder('utf-8');

  for (let i = 1; i <= textRecordCount; i++) {
    if (i >= offsets.length) break;
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : data.byteLength;
    const recordData = new Uint8Array(data.slice(start, end));
    
    let decompressed;
    if (compression === 1) {
      decompressed = recordData;
    } else if (compression === 2) {
      decompressed = decompressPalmDoc(recordData);
    } else {
      continue;
    }
    fullText += decoder.decode(decompressed);
  }
  return fullText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

/**
 * Parsuje MOBI.ZIP soubor (extrahuje první nalezený .mobi a parsuje ho).
 */
export const parseMobiZip = async (data: ArrayBuffer): Promise<string> => {
  const zip = await JSZip.loadAsync(data);
  // Fix: Explicitly cast files to any[] to avoid 'unknown' type error when accessing 'name'
  const mobiFile = (Object.values(zip.files) as any[]).find(file => file.name.toLowerCase().endsWith('.mobi'));
  
  if (!mobiFile) {
    throw new Error("No MOBI file found inside the ZIP archive.");
  }

  // Fix: Explicitly cast to any to avoid 'unknown' type error when calling 'async'
  const mobiBuffer = await (mobiFile as any).async("arraybuffer");
  return parseMobi(mobiBuffer);
};

/**
 * Parsuje EPUB soubor (ZIP kontejner s XHTML).
 */
export const parseEpub = async (data: ArrayBuffer): Promise<string> => {
  const zip = await JSZip.loadAsync(data);
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Missing container.xml");

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "text/xml");
  const rootfile = containerDoc.querySelector("rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("Missing OPF path");

  const opfXml = await zip.file(opfPath)?.async("string");
  if (!opfXml) throw new Error("Missing OPF file");

  const opfDoc = parser.parseFromString(opfXml, "text/xml");
  const manifestItems: Record<string, string> = {};
  const items = opfDoc.querySelectorAll("item");
  items.forEach(item => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifestItems[id] = href;
  });

  const spine = opfDoc.querySelectorAll("spine > itemref");
  let fullText = "";
  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  for (let i = 0; i < spine.length; i++) {
    const idref = spine[i].getAttribute("idref");
    const href = idref ? manifestItems[idref] : null;
    if (href) {
      const fullHref = opfDir + href;
      const htmlFile = await zip.file(fullHref)?.async("string");
      if (htmlFile) {
        const htmlDoc = parser.parseFromString(htmlFile, "text/html");
        htmlDoc.querySelectorAll("script, style, head, nav").forEach(el => el.remove());
        fullText += " " + (htmlDoc.body.innerText || htmlDoc.body.textContent || "");
      }
    }
  }
  return fullText.replace(/\s+/g, " ").trim();
};
