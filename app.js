require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // 使用 promise 版本
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const moment = require('moment-timezone');
const webpush = require('web-push');

// 設定 Node.js 時區為香港（UTC+8）
process.env.TZ = 'Asia/Hong_Kong';

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// 配置 VAPID
webpush.setVapidDetails(
  'mailto:your-email@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 資料庫連線池
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00'
});

// 初始化資料庫表
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
    // 創建用戶表
    await connection.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL
    )`);
    console.log('Users table ready');

    // 創建生字庫表
    await connection.query(`CREATE TABLE IF NOT EXISTS wordlists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    console.log('Wordlists table ready');

    // 創建生字表
    await connection.query(`CREATE TABLE IF NOT EXISTS words (
      id INT AUTO_INCREMENT PRIMARY KEY,
      wordlist_id INT NOT NULL,
      english VARCHAR(255) NOT NULL,
      chinese VARCHAR(255) NOT NULL,
      FOREIGN KEY (wordlist_id) REFERENCES wordlists(id)
    )`);
    console.log('Words table ready');

    // 創建任務表（包含 notified 字段）
    await connection.query(`CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      due_date DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notified BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    console.log('Tasks table ready');

    // 檢查並添加 notified 字段
    const [columns] = await connection.query("SHOW COLUMNS FROM tasks LIKE 'notified'");
    if (columns.length === 0) {
      console.log('Adding notified column to tasks table');
      await connection.query('ALTER TABLE tasks ADD COLUMN notified BOOLEAN DEFAULT FALSE');
      console.log('Notified column added successfully');
      // 初始化現有任務的 notified 狀態
      await connection.query('UPDATE tasks SET notified = TRUE WHERE due_date < NOW()');
      console.log('Initialized notified status for existing tasks');
    } else {
      console.log('Notified column already exists');
    }

    // 創建推送訂閱表
    await connection.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      subscription JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    console.log('Push Subscriptions table ready');

    connection.release();
  } catch (err) {
    console.error('Database Initialization Error:', err.message);
    throw err;
  }
}

// 執行資料庫初始化
initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});

// 根路徑渲染首頁
app.get('/', (req, res) => res.render('index'));

// 註冊路由
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const [results] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (results.length > 0) {
      return res.render('register', { error: '電郵地址已被使用' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
      [username, email, hashedPassword]);
    console.log('用戶註冊成功:', { username, email });
    res.redirect('/login');
  } catch (err) {
    console.error('Register Error:', err.message);
    res.render('register', { error: '伺服器錯誤，請稍後重試' });
  }
});

// 登入路由
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [results] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (results.length === 0) return res.render('login', { error: '用戶名或密碼錯誤' });
    const match = await bcrypt.compare(password, results[0].password);
    if (!match) return res.render('login', { error: '用戶名或密碼錯誤' });
    const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, { httpOnly: true });
    console.log('用戶登入成功:', username);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login Error:', err.message);
    res.render('login', { error: '伺服器錯誤，請稍後重試' });
  }
});

// 登出路由
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// JWT 中間件
const verifyToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    console.warn('無 JWT 令牌，導向登入頁面');
    return res.redirect('/login');
  }
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
app.get('/dashboard', verifyToken, async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (results.length === 0) throw new Error('用戶不存在');
    res.render('dashboard', { username: results[0].username });
  } catch (err) {
    console.error('Dashboard Query Error:', err.message);
    res.render('dashboard', { username: '未知' });
  }
});

// 背默英文生字頁面
app.get('/dictation', verifyToken, async (req, res) => {
  try {
    const [results] = await pool.query('SELECT id, name FROM wordlists WHERE user_id = ?', [req.user.id]);
    res.render('dictation', { wordlists: results });
  } catch (err) {
    console.error('Wordlists Query Error:', err.message);
    res.render('dictation', { wordlists: [] });
  }
});

// API：儲存生字庫
app.post('/dictation/save', verifyToken, async (req, res) => {
  const { wordlistName, words } = req.body;
  if (!wordlistName || !words || !Array.isArray(words)) {
    console.error('無效的生字庫數據:', { wordlistName, words });
    return res.status(400).json({ error: '請提供生字庫名稱和有效的生字列表' });
  }
  try {
    const [result] = await pool.query('INSERT INTO wordlists (user_id, name) VALUES (?, ?)', [req.user.id, wordlistName]);
    const wordlistId = result.insertId;
    const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
    await pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues]);
    console.log('生字庫儲存成功:', { wordlistId, wordlistName });
    res.json({ success: true, wordlistId });
  } catch (err) {
    console.error('Wordlist Insert Error:', err.message);
    res.status(500).json({ error: '儲存生字庫失敗' });
  }
});

// API：取得指定生字庫的生字
app.get('/dictation/words/:wordlistId', verifyToken, async (req, res) => {
  const wordlistId = req.params.wordlistId;
  try {
    const [results] = await pool.query('SELECT id, english, chinese FROM words WHERE wordlist_id = ?', [wordlistId]);
    res.json(results);
  } catch (err) {
    console.error('Words Query Error:', err.message);
    res.status(500).json({ error: '取得生字失敗' });
  }
});

// API：刪除生字庫
app.delete('/dictation/wordlist/:wordlistId', verifyToken, async (req, res) => {
  const wordlistId = req.params.wordlistId;
  try {
    await pool.query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId]);
    await pool.query('DELETE FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Wordlist Delete Error:', err.message);
    res.status(500).json({ error: '刪除生字庫失敗' });
  }
});

// API：更新生字庫中的生字
app.put('/dictation/words/:wordlistId', verifyToken, async (req, res) => {
  const wordlistId = req.params.wordlistId;
  const words = req.body.words;
  if (!words || !Array.isArray(words)) {
    console.error('無效的生字列表:', words);
    return res.status(400).json({ error: '請提供有效的生字列表' });
  }
  try {
    await pool.query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId]);
    if (words.length > 0) {
      const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
      await pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Words Update Error:', err.message);
    res.status(500).json({ error: '更新生字失敗' });
  }
});

// API：新增單個生字
app.post('/dictation/word/:wordlistId', verifyToken, async (req, res) => {
  const wordlistId = req.params.wordlistId;
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    console.error('無效的生字數據:', { english, chinese });
    return res.status(400).json({ error: '請提供英文和中文解釋' });
  }
  try {
    const [results] = await pool.query('SELECT * FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, req.user.id]);
    if (results.length === 0) {
      console.error('無效的生字庫:', wordlistId);
      return res.status(403).json({ error: '無效的生字庫或無權限' });
    }
    const [result] = await pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES (?, ?, ?)', 
      [wordlistId, english, chinese]);
    res.json({ success: true, wordId: result.insertId });
  } catch (err) {
    console.error('Word Insert Error:', err.message);
    res.status(500).json({ error: '新增生字失敗' });
  }
});

// 任務管理頁面
app.get('/taskmanager', verifyToken, (req, res) => {
  res.render('taskmanager', { VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY });
});

// API：提供 VAPID 公鑰
app.get('/vapidPublicKey', (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

// API：儲存推送訂閱
app.post('/subscribe', verifyToken, async (req, res) => {
  const subscription = req.body;
  try {
    // 檢查是否已有訂閱
    const [existing] = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    if (existing.length > 0) {
      // 更新現有訂閱
      await pool.query('UPDATE push_subscriptions SET subscription = ?, created_at = NOW() WHERE user_id = ?', 
        [JSON.stringify(subscription), req.user.id]);
      console.log('推送訂閱更新成功，用戶ID:', req.user.id, '訂閱:', subscription.endpoint);
    } else {
      // 新增訂閱
      await pool.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?, ?)', 
        [req.user.id, JSON.stringify(subscription)]);
      console.log('推送訂閱新增成功，用戶ID:', req.user.id, '訂閱:', subscription.endpoint);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Subscription Insert/Update Error:', err.message);
    res.status(500).json({ error: '儲存訂閱失敗' });
  }
});

// API：測試推送通知
app.post('/test-push', verifyToken, async (req, res) => {
  try {
    const [results] = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    if (results.length === 0) {
      console.error('無訂閱記錄，用戶ID:', req.user.id);
      return res.status(500).json({ error: '無訂閱' });
    }
    const subscription = JSON.parse(results[0].subscription);
    await webpush.sendNotification(subscription, JSON.stringify({
      title: '測試通知',
      body: '這是一條測試推送通知！',
      icon: '/images/icon-192x192.png',
      url: '/taskmanager'
    }));
    console.log('測試推送通知發送成功，用戶ID:', req.user.id, '訂閱:', subscription.endpoint);
    res.json({ success: true });
  } catch (err) {
    console.error('Test Push Error:', err.message, '用戶ID:', req.user.id);
    res.status(500).json({ error: '推送失敗' });
  }
});

// 定時檢查即將到期的任務並發送推送通知
setInterval(async () => {
  const now = moment().tz('Asia/Hong_Kong');
  const inOneMinute = now.clone().add(1, 'minutes');
  try {
    const [results] = await pool.query(
      'SELECT t.*, ps.subscription FROM tasks t JOIN push_subscriptions ps ON t.user_id = ps.user_id WHERE t.due_date BETWEEN ? AND ? AND t.notified = FALSE',
      [now.format('YYYY-MM-DD HH:mm:ss'), inOneMinute.format('YYYY-MM-DD HH:mm:ss')]
    );
    console.log('檢查即將到期任務:', results.length, '個任務');
    for (const task of results) {
      const subscription = JSON.parse(task.subscription);
      const payload = {
        title: '任務提醒',
        body: `您的任務 "${task.title}" 將於 ${moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DD HH:mm')} 到期！`,
        icon: '/images/icon-192x192.png',
        url: '/taskmanager'
      };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        console.log('推送通知發送成功，任務ID:', task.id, '用戶ID:', task.user_id);
        await pool.query('UPDATE tasks SET notified = TRUE WHERE id = ?', [task.id]);
        console.log('任務通知狀態更新成功，任務ID:', task.id);
      } catch (err) {
        console.error('Push Notification Error, 任務ID:', task.id, '用戶ID:', task.user_id, '訂閱:', subscription.endpoint, '錯誤:', err.message);
      }
    }
  } catch (err) {
    console.error('Task Notification Query Error:', err.message);
  }
}, 30 * 1000);

// API：取得用戶的所有任務
app.get('/taskmanager/tasks', verifyToken, async (req, res) => {
  try {
    const [results] = await pool.query('SELECT * FROM tasks WHERE user_id = ?', [req.user.id]);
    const formattedResults = results.map(task => ({
      ...task,
      due_date: moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DDTHH:mm:ssZ')
    }));
    console.log('傳送至前端的任務:', formattedResults);
    res.json(formattedResults);
  } catch (err) {
    console.error('Tasks Query Error:', err.message);
    res.status(500).json({ error: '取得任務失敗' });
  }
});

// API：新增任務
app.post('/taskmanager/add', verifyToken, async (req, res) => {
  const { title, description, due_date } = req.body;
  if (!title || !due_date) {
    console.error('無效的任務數據:', { title, description, due_date });
    return res.status(400).json({ error: '請提供標題和到期日期' });
  }
  if (!moment(due_date, moment.ISO_8601, true).isValid()) {
    console.error('無效的到期日期格式:', due_date);
    return res.status(400).json({ error: '無效的到期日期格式' });
  }
  const formattedDueDate = moment.tz(due_date, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  console.log('儲存任務數據:', { user_id: req.user.id, title, description, due_date, formattedDueDate });
  try {
    const [result] = await pool.query(
      'INSERT INTO tasks (user_id, title, description, due_date, notified) VALUES (?, ?, ?, ?, FALSE)',
      [req.user.id, title, description, formattedDueDate]
    );
    console.log('任務儲存成功，任務ID:', result.insertId);
    res.json({ success: true, taskId: result.insertId });
  } catch (err) {
    console.error('Task Insert Error:', err.message);
    res.status(500).json({ error: '新增任務失敗' });
  }
});

// API：編輯任務
app.put('/taskmanager/edit/:id', verifyToken, async (req, res) => {
  const taskId = req.params.id;
  const { title, description, due_date } = req.body;
  if (!title || !due_date) {
    console.error('無效的任務編輯數據:', { title, description, due_date });
    return res.status(400).json({ error: '請提供標題和到期日期' });
  }
  if (!moment(due_date, moment.ISO_8601, true).isValid()) {
    console.error('無效的到期日期格式:', due_date);
    return res.status(400).json({ error: '無效的到期日期格式' });
  }
  const formattedDueDate = moment.tz(due_date, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  console.log('更新任務數據:', { taskId, user_id: req.user.id, title, description, due_date, formattedDueDate });
  try {
    await pool.query(
      'UPDATE tasks SET title = ?, description = ?, due_date = ?, notified = FALSE WHERE id = ? AND user_id = ?',
      [title, description, formattedDueDate, taskId, req.user.id]
    );
    console.log('任務更新成功，任務ID:', taskId);
    res.json({ success: true });
  } catch (err) {
    console.error('Task Update Error:', err.message);
    res.status(500).json({ error: '編輯任務失敗' });
  }
});

// API：刪除任務
app.delete('/taskmanager/delete/:id', verifyToken, async (req, res) => {
  const taskId = req.params.id;
  try {
    await pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);
    console.log('任務刪除成功，任務ID:', taskId);
    res.json({ success: true });
  } catch (err) {
    console.error('Task Delete Error:', err.message);
    res.status(500).json({ error: '刪除任務失敗' });
  }
});

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));