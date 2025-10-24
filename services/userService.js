const { query } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function getUserById(id) {
  try {
    const results = await query('SELECT id, username, email, role FROM users WHERE id = ?', [id]);
    console.log('getUserById 查詢結果:', { id, results });
    if (!results || results.length === 0) {
      throw new Error('用戶不存在');
    }
    return results[0];
  } catch (err) {
    console.error('getUserById 錯誤:', { id, error: err.message, stack: err.stack });
    throw err;
  }
}

async function registerUser(username, email, password) {
  const [existing] = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    throw new Error('電郵地址已被使用');
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  await query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
    [username, email, hashedPassword, 'user']);
  console.log('用戶註冊成功:', { username, email });
}

async function loginUser(username, password) {
  try {
    const results = await query('SELECT * FROM users WHERE username = ?', [username]);
    console.log('查詢結果:', results);
    if (!results || results.length === 0) {
      throw new Error('用戶名或密碼錯誤');
    }
    const user = results[0];
    if (!user || !user.password) {
      throw new Error('用戶數據不完整');
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw new Error('用戶名或密碼錯誤');
    }
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    console.log('用戶登入成功:', username);
    return token;
  } catch (err) {
    console.error('loginUser Error:', err.message);
    throw err;
  }
}

async function getAllUsers() {
  try {
    const results = await query('SELECT id, username, email, role FROM users');
    console.log('查詢所有用戶結果:', { results });
    return results;
  } catch (err) {
    console.error('getAllUsers 錯誤:', { error: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = { registerUser, loginUser, getUserById, getAllUsers };