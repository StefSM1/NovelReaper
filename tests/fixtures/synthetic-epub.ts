interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

const encoder = new TextEncoder();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unsigned16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function unsigned32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function bytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function storedZip(files: Array<[name: string, content: string]>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const header = bytes(
      unsigned32(0x04034b50),
      unsigned16(20),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned32(crc),
      unsigned32(data.length),
      unsigned32(data.length),
      unsigned16(nameBytes.length),
      unsigned16(0),
      nameBytes,
      data,
    );
    entries.push({ name, data, crc, offset });
    localParts.push(header);
    offset += header.length;
  }

  const centralOffset = offset;
  const centralParts = entries.map((entry) => {
    const nameBytes = encoder.encode(entry.name);
    return bytes(
      unsigned32(0x02014b50),
      unsigned16(20),
      unsigned16(20),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned32(entry.crc),
      unsigned32(entry.data.length),
      unsigned32(entry.data.length),
      unsigned16(nameBytes.length),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned16(0),
      unsigned32(0),
      unsigned32(entry.offset),
      nameBytes,
    );
  });
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = bytes(
    unsigned32(0x06054b50),
    unsigned16(0),
    unsigned16(0),
    unsigned16(entries.length),
    unsigned16(entries.length),
    unsigned32(centralSize),
    unsigned32(centralOffset),
    unsigned16(0),
  );
  return bytes(...localParts, ...centralParts, end);
}

function containerDocument(): string {
  return `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

function syntheticChapter(title: string, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
      <body><h1>${title}</h1><p>${text}</p></body></html>`;
}

export function createSyntheticEpub(options?: { fixedLayout?: boolean }): File {
  const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:novelreaper-test</dc:identifier>
        <dc:title>Synthetic Reader Test</dc:title>
        <dc:creator>NovelReaper</dc:creator>
        <dc:language>en</dc:language>
        <meta property="dcterms:modified">2026-08-22T00:00:00Z</meta>
        ${options?.fixedLayout ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="one" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
        <item id="two" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="one"/><itemref idref="two"/></spine>
    </package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <head><title>Contents</title></head><body><nav epub:type="toc"><ol>
        <li><a href="chapter-1.xhtml">A Quiet Start</a></li>
        <li><a href="chapter-2.xhtml">The Second Page</a></li>
      </ol></nav></body></html>`;
  const archive = storedZip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', containerDocument()],
    ['OEBPS/package.opf', packageDocument],
    ['OEBPS/nav.xhtml', nav],
    ['OEBPS/chapter-1.xhtml', syntheticChapter('A Quiet Start', 'A legal synthetic chapter.')],
    ['OEBPS/chapter-2.xhtml', syntheticChapter('The Second Page', 'Nothing leaves this fixture.')],
  ]);
  const archiveBuffer = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  return new File([archiveBuffer], 'synthetic-reader-test.epub', {
    type: 'application/epub+zip',
  });
}

export function createSyntheticEpub2(): File {
  const packageDocument = `<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:novelreaper-epub2-test</dc:identifier>
        <dc:title>Synthetic EPUB Two</dc:title><dc:creator>NovelReaper</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="one" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
        <item id="two" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine>
    </package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/>
      <docTitle><text>Synthetic EPUB Two</text></docTitle><navMap>
        <navPoint id="one"><navLabel><text>EPUB Two Opening</text></navLabel><content src="chapter-1.xhtml"/></navPoint>
        <navPoint id="two"><navLabel><text>EPUB Two Ending</text></navLabel><content src="chapter-2.xhtml"/></navPoint>
      </navMap></ncx>`;
  const archive = storedZip([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', containerDocument()],
    ['OEBPS/package.opf', packageDocument],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/chapter-1.xhtml', syntheticChapter('EPUB Two Opening', 'A legacy NCX test.')],
    ['OEBPS/chapter-2.xhtml', syntheticChapter('EPUB Two Ending', 'The NCX path works.')],
  ]);
  const archiveBuffer = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  return new File([archiveBuffer], 'synthetic-epub-two.epub', {
    type: 'application/epub+zip',
  });
}
