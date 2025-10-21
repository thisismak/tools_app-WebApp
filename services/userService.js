const { query } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function registerUser(username, email, password) {
  const [existing] = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    throw new Error('電郵地址已被使用');
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  await query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
    [username, email, hashedPassword]);
  console.log('用戶註冊成功:', { username, email });
}

async function loginUser(username, password) {
  const [results] = await query('SELECT * FROM users WHERE username = ?', [username]);
  if (results.length === 0) {
    throw new Error('用戶名或密碼錯誤');
  }
  const match = await bcrypt.compare(password, results[0].password);
  if (!match) {
    throw new Error('用戶名或密碼錯誤');
  }
  const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, { expiresIn: '24h' });
  console.log('用戶登入成功:', username);
  return token;
}

async function getUserById(id) {
  const [results] = await query('SELECT * FROM users WHERE id = ?', [id]);
  if (results.length === 0) {
    throw new Error('用戶不存在');
  }
  return results[0];
}

module.exports = { registerUser, loginUser, getUserById };