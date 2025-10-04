require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// 數據庫連接池（提升效能）
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 創建用戶表
pool.query(`CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
)`, (err) => {
  if (err) {
    console.error('Table Creation Error:', err.message);
    throw err;
  }
  console.log('Users table ready');
});

// 根路徑重定向
app.get('/', (req, res) => res.redirect('/login'));

// 註冊路由
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  pool.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('Register Query Error:', err.message);
      return res.render('register', { error: '伺服器錯誤，請稍後重試' });
    }
    if (results.length > 0) {
      return res.render('register', { error: '電郵地址已被使用' });
    }
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      pool.query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
        [username, email, hashedPassword], 
        (err) => {
          if (err) {
            console.error('Register Error:', err.message);
            return res.render('register', { error: '註冊失敗，請檢查輸入資料' });
          }
          res.redirect('/login');
        }
      );
    } catch (err) {
      console.error('Hash Error:', err.message);
      res.render('register', { error: '伺服器錯誤，請稍後重試' });
    }
  });
});

// 登入路由
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  pool.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
    if (err) {
      console.error('Login Query Error:', err.message);
      return res.render('login', { error: '伺服器錯誤，請稍後重試' });
    }
    if (results.length === 0) return res.render('login', { error: '用戶名或密碼錯誤' });
    const match = await bcrypt.compare(password, results[0].password);
    if (!match) return res.render('login', { error: '用戶名或密碼錯誤' });
    const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  });
});

// JWT中間件
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT Verification Error:', err.message);
    res.redirect('/login');
  }
};

// 儀表板
app.get('/dashboard', verifyToken, (req, res) => {
  pool.query('SELECT * FROM users WHERE id = ?', [req.user.id], (err, results) => {
    if (err) {
      console.error('Dashboard Query Error:', err.message);
      return res.render('dashboard', { userId: '未知' });
    }
    res.render('dashboard', { userId: results[0].id });
  });
});

// 登出
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));