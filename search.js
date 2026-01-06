// 図面検索機能

function searchDrawings(db, query) {
  if (!query || query.trim() === '') {
    // クエリが空の場合は全件取得（最新100件）
    const stmt = db.prepare(`
      SELECT * FROM drawings
      ORDER BY updated_at DESC
      LIMIT 100
    `);
    return stmt.all();
  }

  const searchTerm = query.trim();

  // 全文検索（FTS5）を使用
  // 図版番号、品名、部品名、施主名から検索
  const stmt = db.prepare(`
    SELECT
      d.*,
      bm25(drawings_fts) as rank
    FROM drawings d
    INNER JOIN drawings_fts fts ON d.id = fts.rowid
    WHERE drawings_fts MATCH ?
    ORDER BY rank
    LIMIT 100
  `);

  try {
    const results = stmt.all(searchTerm);
    return results;
  } catch (error) {
    console.error('Search error:', error);

    // FTS5検索がエラーの場合は、LIKE検索にフォールバック
    const fallbackStmt = db.prepare(`
      SELECT * FROM drawings
      WHERE
        file_name LIKE ? OR
        drawing_number LIKE ? OR
        product_name LIKE ? OR
        part_name LIKE ? OR
        client_name LIKE ?
      ORDER BY updated_at DESC
      LIMIT 100
    `);

    const likeTerm = `%${searchTerm}%`;
    return fallbackStmt.all(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
  }
}

// 詳細検索（フィルタ付き）
function advancedSearch(db, filters) {
  let conditions = [];
  let params = [];

  if (filters.drawingNumber) {
    conditions.push('drawing_number LIKE ?');
    params.push(`%${filters.drawingNumber}%`);
  }

  if (filters.productName) {
    conditions.push('product_name LIKE ?');
    params.push(`%${filters.productName}%`);
  }

  if (filters.partName) {
    conditions.push('part_name LIKE ?');
    params.push(`%${filters.partName}%`);
  }

  if (filters.clientName) {
    conditions.push('client_name LIKE ?');
    params.push(`%${filters.clientName}%`);
  }

  if (filters.fileType) {
    conditions.push('file_type = ?');
    params.push(filters.fileType);
  }

  if (filters.dateFrom) {
    conditions.push('updated_at >= ?');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push('updated_at <= ?');
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT * FROM drawings
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT 100
  `;

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

module.exports = {
  searchDrawings,
  advancedSearch
};
