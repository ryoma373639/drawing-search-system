// DOM要素
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const resultsCount = document.getElementById('resultsCount');
const noResults = document.getElementById('noResults');
const welcomeMessage = document.getElementById('welcomeMessage');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');

// ソート/フィルター要素
const sortBySelect = document.getElementById('sortBy');
const sortOrderSelect = document.getElementById('sortOrder');
const fileTypeFilter = document.getElementById('fileTypeFilter');
const tagFilter = document.getElementById('tagFilter');
const resetFilterBtn = document.getElementById('resetFilter');

// エクスポートボタン
const exportCsvBtn = document.getElementById('exportCsvBtn');

// タグ関連要素
const tagSelect = document.getElementById('tagSelect');
const addTagBtn = document.getElementById('addTagBtn');
const currentTagsContainer = document.getElementById('currentTags');

// 初期化
let isUploading = false;
let allTags = []; // 全タグリスト

// ローカルストレージからソート設定を読み込み
const savedSortBy = localStorage.getItem('sortBy') || 'id';
const savedSortOrder = localStorage.getItem('sortOrder') || 'desc';
const savedFileType = localStorage.getItem('fileType') || '';
const savedTagId = localStorage.getItem('tagId') || '';

sortBySelect.value = savedSortBy;
sortOrderSelect.value = savedSortOrder;
fileTypeFilter.value = savedFileType;
tagFilter.value = savedTagId;

// ファイルアップロードボタン
uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

// ファイル選択
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    await uploadFiles(files);
    fileInput.value = ''; // リセット
  }
});

// ドラッグ&ドロップ
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) {
    await uploadFiles(files);
  }
});

// クリックでファイル選択
uploadArea.addEventListener('click', () => {
  if (!isUploading) {
    fileInput.click();
  }
});

// ファイルアップロード
async function uploadFiles(files) {
  if (isUploading) return;

  isUploading = true;
  statusText.textContent = `${files.length}件のファイルをアップロード中...`;

  try {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    // 画像ファイルがある場合は、ブラウザでOCR処理
    const imageFiles = files.filter(f => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.tiff') || ext.endsWith('.tif');
    });

    const ocrTexts = {};

    if (imageFiles.length > 0) {
      statusText.textContent = `画像からテキストを抽出中... (0/${imageFiles.length})`;

      // Tesseract.jsを使用してOCR処理
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        statusText.textContent = `画像からテキストを抽出中... (${i + 1}/${imageFiles.length}) - ${file.name}`;

        try {
          const text = await performOCR(file);
          ocrTexts[file.name] = text;
          console.log(`OCR completed for ${file.name}: ${text.substring(0, 100)}...`);
        } catch (error) {
          console.error(`OCR failed for ${file.name}:`, error);
          ocrTexts[file.name] = '';
        }
      }
    }

    // OCRテキストをFormDataに追加
    if (Object.keys(ocrTexts).length > 0) {
      formData.append('ocrTexts', JSON.stringify(ocrTexts));
    }

    statusText.textContent = 'サーバーにアップロード中...';

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = data.message;
      welcomeMessage.style.display = 'none';
      updateStats();

      // 自動的に検索結果を更新
      await performSearch();

      // 3秒後にステータスをリセット
      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    } else {
      statusText.textContent = 'エラー: ' + (data.error || '不明なエラー');
    }

  } catch (error) {
    console.error('Upload error:', error);
    statusText.textContent = 'アップロードに失敗しました';
  } finally {
    isUploading = false;
  }
}

// Tesseract.jsを使用してOCR処理を実行
async function performOCR(file) {
  try {
    // Tesseract.jsのワーカーを作成
    const { data: { text } } = await Tesseract.recognize(
      file,
      'jpn+eng', // 日本語と英語の両方を認識
      {
        logger: info => {
          // 進捗情報をコンソールに出力（オプション）
          if (info.status === 'recognizing text') {
            console.log(`OCR progress: ${Math.round(info.progress * 100)}%`);
          }
        }
      }
    );

    return text;
  } catch (error) {
    console.error('OCR error:', error);
    throw error;
  }
}

// 統計情報更新
async function updateStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    statsText.textContent = `登録済み: ${data.totalFiles}件`;
  } catch (error) {
    console.error('Stats error:', error);
  }
}

// タグを読み込み
async function loadTags() {
  try {
    const response = await fetch('/api/tags');
    const data = await response.json();
    allTags = data.tags || [];

    // タグフィルタードロップダウンを更新
    tagFilter.innerHTML = '<option value="">すべて</option>';
    allTags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag.id;
      option.textContent = tag.name;
      tagFilter.appendChild(option);
    });

    // 編集モーダルのタグセレクトを更新
    tagSelect.innerHTML = '<option value="">タグを選択...</option>';
    allTags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag.id;
      option.textContent = tag.name;
      tagSelect.appendChild(option);
    });

  } catch (error) {
    console.error('Load tags error:', error);
  }
}

// 検索実行
async function performSearch() {
  const query = searchInput.value.trim();
  const sortBy = sortBySelect.value;
  const sortOrder = sortOrderSelect.value;
  const fileType = fileTypeFilter.value;
  const tagId = tagFilter.value;

  // ソート設定をローカルストレージに保存
  localStorage.setItem('sortBy', sortBy);
  localStorage.setItem('sortOrder', sortOrder);
  localStorage.setItem('fileType', fileType);
  localStorage.setItem('tagId', tagId);

  // ローディング表示
  resultsList.innerHTML = '<div class="loading">検索中</div>';
  noResults.style.display = 'none';
  welcomeMessage.style.display = 'none';

  try {
    // URLパラメータを構築
    const params = new URLSearchParams({
      q: query,
      sortBy: sortBy,
      sortOrder: sortOrder
    });

    if (fileType) {
      params.append('fileType', fileType);
    }

    if (tagId) {
      params.append('tagId', tagId);
    }

    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();

    if (data.results.length === 0) {
      resultsList.innerHTML = '';
      noResults.style.display = 'block';
      resultsCount.textContent = '';
      exportCsvBtn.style.display = 'none';
      return;
    }

    // 検索結果を表示
    displayResults(data.results);
    resultsCount.textContent = `${data.total}件`;
    exportCsvBtn.style.display = 'block';

  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">検索エラーが発生しました</div>';
    exportCsvBtn.style.display = 'none';
  }
}

// 検索結果を表示
function displayResults(results) {
  resultsList.innerHTML = '';

  results.forEach(result => {
    const item = createResultItem(result);
    resultsList.appendChild(item);
  });
}

// 検索結果アイテムを作成
function createResultItem(result) {
  const div = document.createElement('div');
  div.className = 'result-item';

  // ファイルアイコン
  const icon = getFileIcon(result.fileType);

  // メタデータ
  const metaItems = [];

  if (result.drawingNumber) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">図版:</span>${escapeHtml(result.drawingNumber)}</div>`);
  }

  if (result.productName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">品名:</span>${escapeHtml(result.productName)}</div>`);
  }

  if (result.partName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">部品名:</span>${escapeHtml(result.partName)}</div>`);
  }

  if (result.clientName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">施主:</span>${escapeHtml(result.clientName)}</div>`);
  }

  if (result.uploadedAt) {
    const date = new Date(result.uploadedAt);
    metaItems.push(`<div class="meta-item"><span class="meta-label">登録:</span>${date.toLocaleString('ja-JP')}</div>`);
  }

  const fileSize = formatFileSize(result.fileSize);
  if (fileSize) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">サイズ:</span>${fileSize}</div>`);
  }

  // タグ表示
  let tagsHtml = '';
  if (result.tags && result.tags.length > 0) {
    const tagBadges = result.tags.map(tag =>
      `<span class="tag-badge tag-badge-small">${escapeHtml(tag.name)}</span>`
    ).join('');
    tagsHtml = `<div class="tags-container" style="margin-top: 10px;">${tagBadges}</div>`;
  }

  // プレビュー可能なファイルタイプかチェック
  const previewableTypes = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif'];
  const isPreviewable = previewableTypes.includes(result.fileType);

  div.innerHTML = `
    <div class="result-header">
      <div class="file-icon">${icon}</div>
      <div class="result-title">
        <h3>${escapeHtml(result.fileName)}</h3>
      </div>
    </div>
    <div class="result-meta">
      ${metaItems.join('')}
    </div>
    ${tagsHtml}
    <div class="result-actions">
      ${isPreviewable ? `<button class="action-btn preview-btn" data-id="${result.id}">👁️ プレビュー</button>` : ''}
      <button class="action-btn download-btn" data-id="${result.id}">📥 ダウンロード</button>
      <button class="action-btn edit-btn" data-id="${result.id}">✏️ 編集</button>
      <button class="action-btn delete-btn" data-id="${result.id}">🗑️ 削除</button>
    </div>
  `;

  // プレビューボタン
  if (isPreviewable) {
    const previewBtn = div.querySelector('.preview-btn');
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPreviewModal(result);
    });
  }

  // ダウンロードボタン
  const downloadBtn = div.querySelector('.download-btn');
  downloadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await downloadFile(result.id, result.fileName);
  });

  // 編集ボタン
  const editBtn = div.querySelector('.edit-btn');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(result);
  });

  // 削除ボタン
  const deleteBtn = div.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteFile(result.id, result.fileName);
  });

  return div;
}

// ファイルダウンロード
async function downloadFile(id, fileName) {
  try {
    const response = await fetch(`/api/download/${id}`);
    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    statusText.textContent = `${fileName} をダウンロードしました`;
    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);

  } catch (error) {
    console.error('Download error:', error);
    alert('ダウンロードに失敗しました');
  }
}

// ファイル削除
async function deleteFile(id, fileName) {
  // 削除確認ダイアログ
  if (!confirm(`「${fileName}」を削除しますか？\n\nこの操作は取り消せません。`)) {
    return;
  }

  try {
    statusText.textContent = `${fileName} を削除中...`;

    const response = await fetch(`/api/drawing/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok && data.success) {
      statusText.textContent = data.message;

      // 検索結果を自動更新
      await performSearch();

      // 統計情報を更新
      updateStats();

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    } else {
      throw new Error(data.error || '削除に失敗しました');
    }

  } catch (error) {
    console.error('Delete error:', error);
    statusText.textContent = '削除に失敗しました';
    alert(`削除エラー: ${error.message}`);

    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);
  }
}

// ファイルタイプに応じたアイコン
function getFileIcon(fileType) {
  const icons = {
    'pdf': '📄',
    'dwg': '📐',
    'dxf': '📐',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'tiff': '🖼️',
    'tif': '🖼️'
  };
  return icons[fileType] || '📄';
}

// ファイルサイズをフォーマット
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// HTMLエスケープ
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 検索ボタン
searchBtn.addEventListener('click', performSearch);

// Enterキーで検索
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// ソート/フィルター変更時に自動検索
sortBySelect.addEventListener('change', performSearch);
sortOrderSelect.addEventListener('change', performSearch);
fileTypeFilter.addEventListener('change', performSearch);
tagFilter.addEventListener('change', performSearch);

// フィルターリセット
resetFilterBtn.addEventListener('click', () => {
  sortBySelect.value = 'id';
  sortOrderSelect.value = 'desc';
  fileTypeFilter.value = '';
  tagFilter.value = '';
  searchInput.value = '';

  // ローカルストレージをクリア
  localStorage.removeItem('sortBy');
  localStorage.removeItem('sortOrder');
  localStorage.removeItem('fileType');
  localStorage.removeItem('tagId');

  performSearch();
});

// 全削除ボタン
clearBtn.addEventListener('click', async () => {
  if (!confirm('全てのデータを削除しますか？\n（この操作は取り消せません）')) {
    return;
  }

  try {
    const response = await fetch('/api/clear', {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = data.message;
      resultsList.innerHTML = '';
      welcomeMessage.style.display = 'block';
      noResults.style.display = 'none';
      resultsCount.textContent = '';
      updateStats();

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    }

  } catch (error) {
    console.error('Clear error:', error);
    alert('削除に失敗しました');
  }
});

// 初期化: 統計情報とタグを取得
updateStats();
loadTags();

// 編集モーダル要素
const editModal = document.getElementById('editModal');
const closeEditModalBtn = document.getElementById('closeEditModal');
const cancelEditBtn = document.getElementById('cancelEdit');
const saveEditBtn = document.getElementById('saveEdit');
const editIdInput = document.getElementById('editId');
const editFileNameInput = document.getElementById('editFileName');
const editDrawingNumberInput = document.getElementById('editDrawingNumber');
const editProductNameInput = document.getElementById('editProductName');
const editPartNameInput = document.getElementById('editPartName');
const editClientNameInput = document.getElementById('editClientName');

// 編集モーダルを開く
async function openEditModal(drawing) {
  editIdInput.value = drawing.id;
  editFileNameInput.value = drawing.fileName;
  editDrawingNumberInput.value = drawing.drawingNumber || '';
  editProductNameInput.value = drawing.productName || '';
  editPartNameInput.value = drawing.partName || '';
  editClientNameInput.value = drawing.clientName || '';

  // タグを読み込み
  await loadDrawingTags(drawing.id);

  editModal.classList.add('show');
}

// 図面のタグを読み込み
async function loadDrawingTags(drawingId) {
  try {
    const response = await fetch(`/api/drawing/${drawingId}/tags`);
    const data = await response.json();
    const tags = data.tags || [];

    // タグ表示を更新
    currentTagsContainer.innerHTML = '';
    tags.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `
        ${escapeHtml(tag.name)}
        <button class="tag-remove" data-tag-id="${tag.id}" data-drawing-id="${drawingId}">&times;</button>
      `;

      // 削除ボタンのイベント
      const removeBtn = badge.querySelector('.tag-remove');
      removeBtn.addEventListener('click', async () => {
        await removeTagFromDrawing(drawingId, tag.id);
      });

      currentTagsContainer.appendChild(badge);
    });

  } catch (error) {
    console.error('Load drawing tags error:', error);
  }
}

// タグを図面に追加
async function addTagToDrawing(drawingId, tagId) {
  try {
    const response = await fetch(`/api/drawing/${drawingId}/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tagId })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // タグ表示を再読み込み
      await loadDrawingTags(drawingId);
      statusText.textContent = data.message;

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 2000);
    } else {
      throw new Error(data.error || 'タグの追加に失敗しました');
    }

  } catch (error) {
    console.error('Add tag error:', error);
    alert(`エラー: ${error.message}`);
  }
}

// タグを図面から削除
async function removeTagFromDrawing(drawingId, tagId) {
  try {
    const response = await fetch(`/api/drawing/${drawingId}/tag/${tagId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // タグ表示を再読み込み
      await loadDrawingTags(drawingId);
      statusText.textContent = data.message;

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 2000);
    } else {
      throw new Error(data.error || 'タグの削除に失敗しました');
    }

  } catch (error) {
    console.error('Remove tag error:', error);
    alert(`エラー: ${error.message}`);
  }
}

// 編集モーダルを閉じる
function closeEditModal() {
  editModal.classList.remove('show');
}

// モーダルを閉じるイベント
closeEditModalBtn.addEventListener('click', closeEditModal);
cancelEditBtn.addEventListener('click', closeEditModal);

// モーダル背景クリックで閉じる
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) {
    closeEditModal();
  }
});

// ESCキーでモーダルを閉じる
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editModal.classList.contains('show')) {
    closeEditModal();
  }
});

// 編集を保存
saveEditBtn.addEventListener('click', async () => {
  const id = parseInt(editIdInput.value);
  const drawingNumber = editDrawingNumberInput.value.trim();
  const productName = editProductNameInput.value.trim();
  const partName = editPartNameInput.value.trim();
  const clientName = editClientNameInput.value.trim();

  try {
    statusText.textContent = 'メタデータを更新中...';

    const response = await fetch(`/api/drawing/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        drawingNumber,
        productName,
        partName,
        clientName
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      statusText.textContent = data.message;
      closeEditModal();

      // 検索結果を自動更新
      await performSearch();

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    } else {
      throw new Error(data.error || '更新に失敗しました');
    }

  } catch (error) {
    console.error('Update error:', error);
    statusText.textContent = '更新に失敗しました';
    alert(`更新エラー: ${error.message}`);

    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);
  }
});

// タグ追加ボタン
addTagBtn.addEventListener('click', async () => {
  const tagId = tagSelect.value;
  const drawingId = parseInt(editIdInput.value);

  if (!tagId) {
    alert('タグを選択してください');
    return;
  }

  await addTagToDrawing(drawingId, tagId);

  // セレクトをリセット
  tagSelect.value = '';
});

// CSVエクスポート
exportCsvBtn.addEventListener('click', async () => {
  try {
    statusText.textContent = 'CSVファイルを生成中...';

    const query = searchInput.value.trim();
    const sortBy = sortBySelect.value;
    const sortOrder = sortOrderSelect.value;
    const fileType = fileTypeFilter.value;

    // URLパラメータを構築
    const params = new URLSearchParams({
      q: query,
      sortBy: sortBy,
      sortOrder: sortOrder
    });

    if (fileType) {
      params.append('fileType', fileType);
    }

    // CSVファイルをダウンロード
    const response = await fetch(`/api/export/csv?${params.toString()}`);

    if (!response.ok) {
      throw new Error('エクスポートに失敗しました');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // ファイル名を取得（レスポンスヘッダーから）
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'drawings.csv';

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    statusText.textContent = 'CSVファイルをダウンロードしました';

    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);

  } catch (error) {
    console.error('Export error:', error);
    statusText.textContent = 'エクスポートに失敗しました';
    alert(`エクスポートエラー: ${error.message}`);

    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);
  }
});

// プレビューモーダル要素
const previewModal = document.getElementById('previewModal');
const closePreviewModalBtn = document.getElementById('closePreviewModal');
const previewTitle = document.getElementById('previewTitle');
const previewContainer = document.getElementById('previewContainer');

// プレビューモーダルを開く
function openPreviewModal(drawing) {
  previewTitle.textContent = `${drawing.fileName} - プレビュー`;
  previewContainer.innerHTML = '';

  // ファイルタイプに応じてプレビューを表示
  const previewUrl = `/api/preview/${drawing.id}`;

  if (drawing.fileType === 'pdf') {
    // PDFの場合はiframeで表示
    const iframe = document.createElement('iframe');
    iframe.src = previewUrl;
    iframe.style.width = '100%';
    iframe.style.height = '70vh';
    iframe.style.border = 'none';
    previewContainer.appendChild(iframe);
  } else if (['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(drawing.fileType)) {
    // 画像の場合はimgタグで表示
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = drawing.fileName;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '0 auto';
    previewContainer.appendChild(img);
  } else {
    // 対応していないファイルタイプ
    const message = document.createElement('p');
    message.textContent = 'このファイル形式はプレビューできません';
    message.style.textAlign = 'center';
    message.style.padding = '40px';
    message.style.color = '#999';
    previewContainer.appendChild(message);
  }

  previewModal.classList.add('show');
}

// プレビューモーダルを閉じる
function closePreviewModal() {
  previewModal.classList.remove('show');
  previewContainer.innerHTML = ''; // コンテンツをクリア
}

// モーダルを閉じるイベント
closePreviewModalBtn.addEventListener('click', closePreviewModal);

// モーダル背景クリックで閉じる
previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) {
    closePreviewModal();
  }
});

// ESCキーでモーダルを閉じる（プレビューモーダル用）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && previewModal.classList.contains('show')) {
    closePreviewModal();
  }
});
