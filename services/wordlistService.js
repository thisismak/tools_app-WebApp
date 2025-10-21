const { query } = require('../db');

async function getWordlists(userId) {
  return await query('SELECT id, name FROM wordlists WHERE user_id = ?', [userId]);
}

async function createWordlist(userId, name, words) {
  const [result] = await query('INSERT INTO wordlists (user_id, name) VALUES (?, ?)', [userId, name]);
  const wordlistId = result.insertId;
  if (words && words.length > 0) {
    const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
    await query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues]);
  }
  console.log('生字庫儲存成功:', { wordlistId, name });
  return wordlistId;
}

async function deleteWordlist(userId, wordlistId) {
  await query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId]);
  await query('DELETE FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, userId]);
  console.log('生字庫刪除成功:', wordlistId);
}

module.exports = { getWordlists, createWordlist, deleteWordlist };