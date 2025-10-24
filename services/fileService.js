const { query } = require('../db');
const fs = require('fs').promises;
const path = require('path');

const uploadDir = path.join(__dirname, '../public/uploads');

async function ensureUploadDir() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (err) {
    console.error('創建上傳目錄失敗:', err);
    throw new Error('無法創建上傳目錄');
  }
}

async function saveFile(userId, filename, originalName, customName, description) {
  try {
    await query(
      'INSERT INTO files (user_id, filename, original_name, custom_name, description) VALUES (?, ?, ?, ?, ?)',
      [userId, filename, originalName, customName, description]
    );
    console.log('檔案記錄儲存成功:', { userId, filename, customName });
  } catch (err) {
    console.error('儲存檔案記錄失敗:', err);
    throw new Error('儲存檔案記錄失敗');
  }
}

async function getFiles(userId) {
  try {
    const results = await query(
      'SELECT filename, original_name, custom_name, description, uploaded_at FROM files WHERE user_id = ?',
      [userId]
    );
    console.log('查詢檔案結果:', { userId, results });
    return results || [];
  } catch (err) {
    console.error('查詢檔案失敗:', err);
    throw new Error('查詢檔案失敗');
  }
}

async function deleteFile(userId, filename) {
  try {
    const filePath = path.join(uploadDir, filename);
    await fs.unlink(filePath);
    await query('DELETE FROM files WHERE user_id = ? AND filename = ?', [userId, filename]);
    console.log('檔案刪除成功:', { userId, filename });
  } catch (err) {
    console.error('刪除檔案失敗:', err);
    throw new Error('刪除檔案失敗');
  }
}

module.exports = { ensureUploadDir, saveFile, getFiles, deleteFile };