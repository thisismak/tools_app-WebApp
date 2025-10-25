require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const webpush = require('web-push');
const moment = require('moment-timezone');
const { initializeDatabase, query } = require('./db');
const userService = require('./services/userService');
const wordlistService = require('./services/wordlistService');
const wordService = require('./services/wordService');
const taskService = require('./services/taskService');
const subscriptionService = require('./services/subscriptionService');
const fileService = require('./services/fileService');
const multer = require('multer');
const path = require('path');

process.env.TZ = 'Asia/Hong_Kong';

const app = express();

// 配置 Multer 檔案上傳
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fileService.ensureUploadDir();
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 限制檔案大小為 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('僅支援 JPEG、PNG、PDF 和純文本檔案'));
    }
  }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

webpush.setVapidDetails(
  'mailto:support@mysandshome.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});

// 載入站點設定
async function loadSiteSettings() {
  try {
    const results = await query('SELECT setting_key, setting_value FROM site_settings');
    const settings = {};
    results.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    return settings;
  } catch (err) {
    console.error('載入站點設定失敗:', err.message);
    return {
      site_title: '技術人員內部網站',
      index_meta_description: '技術人員內部網站，提供英文生字背默、任務管理和檔案管理功能，助力技術人員高效學習和工作。',
      index_meta_keywords: '技術人員, 英文學習, 生字背默, 任務管理, 檔案管理, PWA應用',
      index_og_title: '技術人員內部網站 - 高效學習與管理平台',
      index_og_description: '專為技術人員設計的學習與管理工具，支持英文生字背默、任務管理和檔案管理，提升工作效率。',
      login_meta_description: '登入技術人員內部網站，管理您的學習和工作任務。',
      login_meta_keywords: '技術人員, 登入, 學習管理, 任務管理',
      login_og_title: '技術人員內部網站 - 登入',
      login_og_description: '登入技術人員內部網站，開始管理您的學習和工作任務。',
      register_meta_description: '註冊技術人員內部網站，體驗高效的學習與管理工具。',
      register_meta_keywords: '技術人員, 註冊, 學習管理, PWA應用',
      register_og_title: '技術人員內部網站 - 註冊',
      register_og_description: '立即註冊技術人員內部網站，體驗高效的學習與管理工具。'
    };
  }
}

// 管理員權限中間件
const verifyAdmin = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.user.id);
    if (user.role !== 'admin') {
      console.warn('非管理員嘗試訪問後台:', { userId: req.user.id });
      return res.status(403).json({ success: false, error: '無管理員權限' });
    }
    next();
  } catch (err) {
    console.error('檢查管理員權限失敗:', err.message);
    res.redirect('/login');
  }
};

// 記錄日誌的輔助函數
async function logActivity(userId, action, details) {
  try {
    await query('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)', 
      [userId, action, details]);
    console.log('活動日誌記錄:', { userId, action, details });
  } catch (err) {
    console.error('記錄日誌失敗:', err.message);
  }
}

// 公開頁面路由
app.get('/', async (req, res) => {
  const settings = await loadSiteSettings();
  res.render('index', { siteSettings: settings });
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const settings = await loadSiteSettings();
    res.header('Content-Type', 'application/xml');
    res.render('sitemap', { settings });
  } catch (err) {
    console.error('生成sitemap失敗:', err.message);
    res.status(500).send('生成網站地圖失敗');
  }
});

app.get('/register', async (req, res) => {
  const settings = await loadSiteSettings();
  res.render('register', { error: null, siteSettings: settings });
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    await userService.registerUser(username, email, password);
    await logActivity(null, '用戶註冊', `新用戶註冊: ${username} (${email})`);
    res.redirect('/login');
  } catch (err) {
    const settings = await loadSiteSettings();
    res.render('register', { error: err.message, siteSettings: settings });
  }
});

app.get('/login', async (req, res) => {
  const settings = await loadSiteSettings();
  res.render('login', { error: null, siteSettings: settings });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('登入請求:', { username, password: '[隱藏]' });
  try {
    const token = await userService.loginUser(username, password);
    res.cookie('token', token, { httpOnly: true });
    await logActivity(null, '用戶登入', `用戶 ${username} 登入`);
    res.redirect('/dashboard');
  } catch (err) {
    const settings = await loadSiteSettings();
    res.render('login', { error: err.message, siteSettings: settings });
  }
});

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

// 後台路由
app.get('/admin', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    await logActivity(req.user.id, '訪問後台儀表板', `用戶 ${user.username} 訪問了後台儀表板`);
    res.render('admin/dashboard', { username: user.username });
  } catch (err) {
    console.error('載入後台儀表板失敗:', err.message);
    res.status(500).json({ success: false, error: '載入儀表板失敗' });
  }
});

app.get('/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    await logActivity(req.user.id, '查看用戶列表', '訪問了用戶管理頁面');
    res.render('admin/users', { users });
  } catch (err) {
    console.error('載入用戶列表失敗:', err.message);
    res.status(500).json({ success: false, error: '載入用戶列表失敗' });
  }
});

app.put('/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { username, email, role } = req.body;
  try {
    const result = await query(
      'UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?',
      [username, email, role, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '用戶不存在' });
    }
    await logActivity(req.user.id, '編輯用戶', `編輯了用戶ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('編輯用戶失敗:', err.message);
    res.status(500).json({ success: false, error: '編輯用戶失敗' });
  }
});

app.delete('/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '用戶不存在' });
    }
    await logActivity(req.user.id, '刪除用戶', `刪除了用戶ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除用戶失敗:', err.message);
    res.status(500).json({ success: false, error: '刪除用戶失敗' });
  }
});

app.get('/admin/tasks', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const tasks = await query(`
      SELECT t.*, u.username 
      FROM tasks t 
      LEFT JOIN users u ON t.user_id = u.id
    `);
    await logActivity(req.user.id, '查看任務列表', '訪問了任務管理頁面');
    res.render('admin/tasks', { tasks, moment });
  } catch (err) {
    console.error('載入任務列表失敗:', err.message);
    res.status(500).json({ success: false, error: '載入任務列表失敗' });
  }
});

app.delete('/admin/tasks/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '任務不存在' });
    }
    await logActivity(req.user.id, '刪除任務', `刪除了任務ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除任務失敗:', err.message);
    res.status(500).json({ success: false, error: '刪除任務失敗' });
  }
});

app.get('/admin/files', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const files = await query(`
      SELECT f.*, u.username 
      FROM files f 
      LEFT JOIN users u ON f.user_id = u.id
    `);
    await logActivity(req.user.id, '查看檔案列表', '訪問了檔案管理頁面');
    res.render('admin/files', { files, moment });
  } catch (err) {
    console.error('載入檔案列表失敗:', err.message);
    res.status(500).json({ success: false, error: '載入檔案列表失敗' });
  }
});

app.delete('/admin/files/:filename', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await fileService.deleteFile(null, req.params.filename);
    await logActivity(req.user.id, '刪除檔案', `刪除了檔案: ${req.params.filename}`);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除檔案失敗:', err.message);
    res.status(500).json({ success: false, error: '刪除檔案失敗' });
  }
});

app.get('/admin/dictation', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const wordlists = await query(`
      SELECT w.*, u.username, COUNT(words.id) as word_count
      FROM wordlists w
      LEFT JOIN users u ON w.user_id = u.id
      LEFT JOIN words ON w.id = words.wordlist_id
      GROUP BY w.id
    `);
    await logActivity(req.user.id, '查看生字庫列表', '訪問了生字管理頁面');
    res.render('admin/dictation', { wordlists });
  } catch (err) {
    console.error('載入生字庫列表失敗:', err.message);
    res.status(500).json({ success: false, error: '載入生字庫列表失敗' });
  }
});

app.get('/admin/dictation/words/:wordlistId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const words = await wordService.getWordsByWordlist(req.params.wordlistId);
    res.json(words);
  } catch (err) {
    console.error('載入生字失敗:', err.message);
    res.status(500).json({ success: false, error: '載入生字失敗' });
  }
});

app.delete('/admin/dictation/:wordlistId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    await wordlistService.deleteWordlist(null, req.params.wordlistId);
    await logActivity(req.user.id, '刪除生字庫', `刪除了生字庫ID: ${req.params.wordlistId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除生字庫失敗:', err.message);
    res.status(500).json({ success: false, error: '刪除生字庫失敗' });
  }
});

app.get('/admin/settings', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const settings = await loadSiteSettings();
    await logActivity(req.user.id, '查看系統設定', '訪問了系統設定頁面');
    res.render('admin/settings', { settings });
  } catch (err) {
    console.error('載入系統設定失敗:', err.message);
    res.status(500).json({ success: false, error: '載入系統設定失敗' });
  }
});

app.post('/admin/settings', verifyToken, verifyAdmin, async (req, res) => {
  const { site_title, vapid_public_key } = req.body;
  try {
    await query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [site_title, 'site_title']);
    await query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [vapid_public_key, 'vapid_public_key']);
    await logActivity(req.user.id, '更新系統設定', `更新了站點標題和VAPID公鑰`);
    res.json({ success: true });
  } catch (err) {
    console.error('更新系統設定失敗:', err.message);
    res.status(500).json({ success: false, error: '更新系統設定失敗' });
  }
});

app.get('/admin/seo', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const settings = await loadSiteSettings();
    await logActivity(req.user.id, '查看SEO設定', '訪問了SEO管理頁面');
    res.render('admin/seo', { settings });
  } catch (err) {
    console.error('載入SEO設定失敗:', err.message);
    res.status(500).json({ success: false, error: '載入SEO設定失敗' });
  }
});

app.post('/admin/seo', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await query('UPDATE site_settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
    }
    await logActivity(req.user.id, '更新SEO設定', '更新了SEO元標籤');
    res.json({ success: true });
  } catch (err) {
    console.error('更新SEO設定失敗:', err.message);
    res.status(500).json({ success: false, error: '更新SEO設定失敗' });
  }
});

app.get('/admin/logs', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const logs = await query(`
      SELECT l.*, u.username 
      FROM activity_logs l 
      LEFT JOIN users u ON l.user_id = u.id 
      ORDER BY l.created_at DESC 
      LIMIT 100
    `);
    await logActivity(req.user.id, '查看日誌', '訪問了日誌查看頁面');
    res.render('admin/logs', { logs, moment });
  } catch (err) {
    console.error('載入日誌失敗:', err.message);
    res.status(500).json({ success: false, error: '載入日誌失敗' });
  }
});

app.get('/dashboard', verifyToken, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    console.log('載入 dashboard:', { userId: req.user.id, username: user ? user.username : '未找到用戶', role: user ? user.role : 'user' });
    res.render('dashboard', { 
      username: user ? user.username : '未知', 
      role: user ? user.role : 'user'  // 新增這行：傳遞 role 變數
    });
  } catch (err) {
    console.error('載入 dashboard 錯誤:', { userId: req.user.id, error: err.message, stack: err.stack });
    res.render('dashboard', { username: '未知', role: 'user' });  // 錯誤時也提供預設 role
  }
});

app.get('/dictation', verifyToken, async (req, res) => {
  try {
    const wordlists = await wordlistService.getWordlists(req.user.id);
    res.render('dictation', { wordlists });
  } catch (err) {
    res.render('dictation', { wordlists: [] });
  }
});

app.post('/dictation/save', verifyToken, async (req, res) => {
  const { wordlistName, words } = req.body;
  if (!wordlistName || !words || !Array.isArray(words)) {
    return res.status(400).json({ success: false, error: '請提供生字庫名稱和有效的生字列表' });
  }
  try {
    const wordlistId = await wordlistService.createWordlist(req.user.id, wordlistName, words);
    res.json({ success: true, wordlistId });
  } catch (err) {
    res.status(500).json({ success: false, error: '儲存生字庫失敗' });
  }
});

app.get('/dictation/words/:wordlistId', verifyToken, async (req, res) => {
  try {
    const words = await wordService.getWordsByWordlist(req.params.wordlistId);
    res.json(words);
  } catch (err) {
    res.status(500).json({ success: false, error: '取得生字失敗' });
  }
});

app.delete('/dictation/wordlist/:wordlistId', verifyToken, async (req, res) => {
  try {
    await wordlistService.deleteWordlist(req.user.id, req.params.wordlistId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: '刪除生字庫失敗' });
  }
});

app.put('/dictation/words/:wordlistId', verifyToken, async (req, res) => {
  const { words } = req.body;
  if (!words || !Array.isArray(words)) {
    return res.status(400).json({ success: false, error: '請提供有效的生字列表' });
  }
  try {
    await wordService.updateWords(req.params.wordlistId, words);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: '更新生字失敗' });
  }
});

app.post('/dictation/word/:wordlistId', verifyToken, async (req, res) => {
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ success: false, error: '請提供英文和中文解釋' });
  }
  try {
    const wordId = await wordService.addWord(req.params.wordlistId, req.user.id, english, chinese);
    res.json({ success: true, wordId });
  } catch (err) {
    res.status(err.message.includes('無效的生字庫') ? 403 : 500).json({ success: false, error: err.message });
  }
});

app.get('/taskmanager', verifyToken, async (req, res) => {
  const settings = await loadSiteSettings();
  res.render('taskmanager', { VAPID_PUBLIC_KEY: settings.vapid_public_key });
});

app.get('/vapidPublicKey', async (req, res) => {
  const settings = await loadSiteSettings();
  res.send(settings.vapid_public_key);
});

app.post('/subscribe', verifyToken, async (req, res) => {
  try {
    await subscriptionService.saveSubscription(req.user.id, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('訂閱路由錯誤:', { userId: req.user?.id, error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: '儲存訂閱失敗' });
  }
});

app.post('/test-push', verifyToken, async (req, res) => {
  try {
    const subscription = await subscriptionService.getSubscription(req.user.id);
    await webpush.sendNotification(subscription, JSON.stringify({
      title: '測試通知',
      body: '這是一條測試推送通知！',
      icon: '/images/icon-192x192.png',
      url: '/taskmanager'
    }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

setInterval(async () => {
  try {
    const tasks = await taskService.checkUpcomingTasks();
    console.log('檢查即將到期任務:', tasks.length, '個任務');
    for (const task of tasks) {
      const payload = {
        title: '任務提醒',
        body: `您的任務 "${task.title}" 將於 ${moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DD HH:mm')} 到期！`,
        icon: '/images/icon-192x192.png',
        url: '/taskmanager'
      };
      for (const subscription of task.subscriptions) {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(payload));
          console.log('推送通知發送成功:', task.id, subscription.endpoint);
        } catch (err) {
          console.error('Push Notification Error, 任務ID:', task.id, '用戶ID:', task.user_id, '訂閱:', subscription.endpoint, '錯誤:', err.message);
        }
      }
      await taskService.markTaskAsNotified(task.id);
    }
  } catch (err) {
    console.error('Task Notification Query Error:', err.message);
  }
}, 60 * 1000);

app.get('/taskmanager/tasks', verifyToken, async (req, res) => {
  try {
    const tasks = await taskService.getTasks(req.user.id);
    console.log('返回任務列表:', { userId: req.user.id, tasks });
    res.json(tasks || []);
  } catch (err) {
    console.error('取得任務失敗:', err.message);
    res.status(500).json({ success: false, error: '取得任務失敗' });
  }
});

app.post('/taskmanager/add', verifyToken, async (req, res) => {
  const { title, description, due_date } = req.body;
  console.log('收到任務新增請求:', { title, description, due_date });
  if (!title || !due_date) {
    return res.status(400).json({
      success: false,
      error: '請提供標題和到期時間'
    });
  }
  try {
    const parsedDate = moment(due_date, moment.ISO_8601, true);
    if (!parsedDate.isValid()) {
      console.error('無效的日期格式:', due_date);
      return res.status(400).json({
        success: false,
        error: '無效的日期時間格式'
      });
    }
    if (parsedDate.isBefore(moment())) {
      console.error('到期時間早於當前時間:', due_date);
      return res.status(400).json({
        success: false,
        error: '到期時間必須是未來時間'
      });
    }
    const normalizedDate = parsedDate.format('YYYY-MM-DDTHH:mm:ss.SSSZ');
    const taskId = await taskService.addTask(
      req.user.id,
      title.trim(),
      (description || '').trim(),
      normalizedDate
    );
    res.json({
      success: true,
      taskId
    });
  } catch (err) {
    console.error('創建任務錯誤:', err.message);
    res.status(400).json({
      success: false,
      error: err.message || '創建任務失敗'
    });
  }
});

app.put('/taskmanager/edit/:id', verifyToken, async (req, res) => {
  const { title, description, due_date } = req.body;
  console.log('收到任務編輯請求:', { id: req.params.id, title, description, due_date });
  try {
    const parsedDate = moment(due_date, moment.ISO_8601, true);
    if (!parsedDate.isValid()) {
      console.error('無效的日期格式:', due_date);
      return res.status(400).json({
        success: false,
        error: '無效的日期時間格式'
      });
    }
    if (parsedDate.isBefore(moment())) {
      console.error('到期時間早於當前時間:', due_date);
      return res.status(400).json({
        success: false,
        error: '到期時間必須是未來時間'
      });
    }
    await taskService.editTask(req.user.id, req.params.id, title, description, due_date);
    res.json({ success: true });
  } catch (err) {
    console.error('編輯任務錯誤:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/taskmanager/delete/:id', verifyToken, async (req, res) => {
  try {
    await taskService.deleteTask(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除任務錯誤:', err.message);
    res.status(500).json({ success: false, error: '刪除任務失敗' });
  }
});

// 檔案管理路由
app.get('/filemanager', verifyToken, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    res.render('filemanager', { username: user ? user.username : '未知' });
  } catch (err) {
    console.error('載入檔案管理頁面錯誤:', err);
    res.redirect('/dashboard');
  }
});

app.get('/filemanager/files', verifyToken, async (req, res) => {
  try {
    const files = await fileService.getFiles(req.user.id);
    res.json(files);
  } catch (err) {
    console.error('取得檔案列表失敗:', err);
    res.status(500).json({ success: false, error: '取得檔案列表失敗' });
  }
});

app.post('/filemanager/upload', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '請選擇一個檔案' });
    }
    const { customName, description } = req.body;
    if (!customName) {
      return res.status(400).json({ success: false, error: '請提供檔案名稱' });
    }
    await fileService.saveFile(req.user.id, req.file.filename, req.file.originalname, customName, description || '');
    res.json({ success: true });
  } catch (err) {
    console.error('檔案上傳錯誤:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/filemanager/edit/:filename', verifyToken, async (req, res) => {
  try {
    const { customName, description } = req.body;
    if (!customName) {
      return res.status(400).json({ success: false, error: '請提供檔案名稱' });
    }
    await fileService.editFile(req.user.id, req.params.filename, customName, description || '');
    res.json({ success: true });
  } catch (err) {
    console.error('編輯檔案資訊錯誤:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/filemanager/delete/:filename', verifyToken, async (req, res) => {
  try {
    await fileService.deleteFile(req.user.id, req.params.filename);
    res.json({ success: true });
  } catch (err) {
    console.error('刪除檔案錯誤:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/logout', async (req, res) => {
  console.log('處理登出請求');
  await logActivity(req.user?.id, '用戶登出', `用戶ID ${req.user?.id} 登出`);
  res.clearCookie('token');
  res.redirect('/login');
});

app.use((err, req, res, next) => {
  console.error('Global Error:', err.message);
  res.status(500).json({ success: false, error: '伺服器內部錯誤' });
});

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));