const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const DxfParser = require('dxf-parser');

// ファイルからメタデータとテキストを抽出してインデックスに追加
async function indexFile(db, filePath, action = 'add') {
  try {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const fileExt = path.extname(filePath).toLowerCase();

    // ファイル名から図版番号と品名を抽出
    const { drawingNumber, productName } = parseFileName(fileName);

    let partName = '';
    let clientName = '';

    // ファイルタイプに応じてテキスト抽出
    if (fileExt === '.pdf') {
      const extracted = await extractFromPDF(filePath);
      partName = extracted.partName;
      clientName = extracted.clientName;
    } else if (['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(fileExt)) {
      const extracted = await extractFromImage(filePath);
      partName = extracted.partName;
      clientName = extracted.clientName;
    } else if (['.dwg', '.dxf'].includes(fileExt)) {
      // CAD図面の場合
      if (fileExt === '.dxf') {
        const extracted = await extractFromDXF(filePath);
        partName = extracted.partName;
        clientName = extracted.clientName;
      }
      // .dwgは直接読めないため、ファイル名のみから情報を取得
    }

    // データベースに保存
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO drawings (
        file_path, file_name, drawing_number, product_name,
        part_name, client_name, file_type, file_size,
        created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      filePath,
      fileName,
      drawingNumber,
      productName,
      partName,
      clientName,
      fileExt.replace('.', ''),
      stats.size,
      stats.birthtime.toISOString(),
      stats.mtime.toISOString()
    );

    console.log(`Indexed: ${fileName}`);
    return { success: true, fileName };

  } catch (error) {
    console.error(`Error indexing ${filePath}:`, error);
    throw error;
  }
}

// ファイル名から図版番号と品名を抽出
// 形式: "図版番号_品名.拡張子"
// 例: "A-001_配管.dwg", "B-123_平面図.pdf"
function parseFileName(fileName) {
  const nameWithoutExt = path.parse(fileName).name;

  // アンダースコアで分割
  const parts = nameWithoutExt.split('_');

  let drawingNumber = '';
  let productName = '';

  if (parts.length >= 2) {
    drawingNumber = parts[0].trim();
    productName = parts.slice(1).join('_').trim();
  } else if (parts.length === 1) {
    // アンダースコアがない場合は全体を図版番号とする
    drawingNumber = parts[0].trim();
  }

  return { drawingNumber, productName };
}

// PDFからテキストを抽出
async function extractFromPDF(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);

    const text = data.text;

    // テキストから部品名と施主名を抽出（キーワードベース）
    const partName = extractPartName(text);
    const clientName = extractClientName(text);

    return { partName, clientName };
  } catch (error) {
    console.error('PDF extraction error:', error);
    return { partName: '', clientName: '' };
  }
}

// 画像からOCRでテキストを抽出
async function extractFromImage(filePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(filePath, 'jpn', {
      logger: () => {} // ログを抑制
    });

    const partName = extractPartName(text);
    const clientName = extractClientName(text);

    return { partName, clientName };
  } catch (error) {
    console.error('OCR extraction error:', error);
    return { partName: '', clientName: '' };
  }
}

// DXFファイルからテキストを抽出
async function extractFromDXF(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parser = new DxfParser();
    const dxf = parser.parseSync(fileContent);

    // DXFのテキストエンティティから情報を抽出
    let text = '';

    if (dxf.entities && dxf.entities.length > 0) {
      dxf.entities.forEach(entity => {
        if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
          if (entity.text) {
            text += entity.text + ' ';
          }
        }
      });
    }

    const partName = extractPartName(text);
    const clientName = extractClientName(text);

    return { partName, clientName };
  } catch (error) {
    console.error('DXF extraction error:', error);
    return { partName: '', clientName: '' };
  }
}

// テキストから部品名を抽出
function extractPartName(text) {
  // 部品名のパターンマッチング
  // 例: "部品名：○○"、"部品：○○"、"品名：○○"
  const patterns = [
    /部品名[：:]\s*([^\n\r]+)/,
    /部品[：:]\s*([^\n\r]+)/,
    /品名[：:]\s*([^\n\r]+)/,
    /PART[：:]\s*([^\n\r]+)/i,
    /COMPONENT[：:]\s*([^\n\r]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100); // 最大100文字
    }
  }

  return '';
}

// テキストから施主名を抽出
function extractClientName(text) {
  // 施主名のパターンマッチング
  // 例: "施主：○○"、"発注者：○○"、"クライアント：○○"
  const patterns = [
    /施主[：:]\s*([^\n\r]+)/,
    /発注者[：:]\s*([^\n\r]+)/,
    /クライアント[：:]\s*([^\n\r]+)/,
    /CLIENT[：:]\s*([^\n\r]+)/i,
    /OWNER[：:]\s*([^\n\r]+)/i,
    /([^\n\r]*株式会社[^\n\r]*)/,
    /([^\n\r]*有限会社[^\n\r]*)/,
    /([^\n\r]*合同会社[^\n\r]*)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100); // 最大100文字
    }
  }

  return '';
}

module.exports = {
  indexFile,
  parseFileName,
  extractPartName,
  extractClientName
};
