const { query } = require('../db');

async function getWordsByWordlist(wordlistId) {
  return await query('SELECT id, english, chinese FROM words WHERE wordlist_id = ?', [wordlistId]);
}

async function addWord(wordlistId, userId, english, chinese) {
  const [results] = await query('SELECT * FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, userId]);
  if (results.length === 0) {
    throw new Error('無效的生字庫或無權限');
  }
  const [result] = await query('INSERT INTO words (wordlist_id, english, chinese) VALUES (?, ?, ?)', 
    [wordlistId, english, chinese]);
  console.log('生字新增成功:', { wordlistId, english, chinese });
  return result.insertId;
}

async function updateWords(wordlistId, words) {
  await query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId]);
  if (words && words.length > 0) {
    const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
    await query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues]);
  }
  console.log('生字更新成功:', wordlistId);
}

module.exports = { getWordsByWordlist, addWord, updateWords };