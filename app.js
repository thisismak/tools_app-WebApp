require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const webpush = require('web-push');
const moment = require('moment-timezone');

const { initializeDatabase } = require('./db');
const userService = require('./services/userService');
const wordlistService = require('./services/wordlistService');
const wordService = require('./services/wordService');
const taskService = require('./services/taskService');
const subscriptionService = require('./services/subscriptionService');

process.env.TZ = 'Asia/Hong_Kong';

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

initializeDatabase().catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});

app.get('/', (req, res) => res.render('index'));

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    await userService.registerUser(username, email, password);
    res.redirect('/login');
  } catch (err) {
    res.render('register', { error: err.message });
  }
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('登入請求:', { username, password: '[隱藏]' });
  try {
    const token = await userService.loginUser(username, password);
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  } catch (err) {
    res.render('login', { error: err.message });
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

app.get('/dashboard', verifyToken, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    console.log('載入 dashboard:', { userId: req.user.id, username: user ? user.username : '未找到用戶' });
    res.render('dashboard', { username: user ? user.username : '未知' });
  } catch (err) {
    console.error('載入 dashboard 錯誤:', { userId: req.user.id, error: err.message, stack: err.stack });
    res.render('dashboard', { username: '未知' });
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

app.get('/taskmanager', verifyToken, (req, res) => {
  res.render('taskmanager', { VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY });
});

app.get('/vapidPublicKey', (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
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
      try {
        await webpush.sendNotification(task.subscription, JSON.stringify(payload));
        await taskService.markTaskAsNotified(task.id);
      } catch (err) {
        console.error('Push Notification Error, 任務ID:', task.id, '用戶ID:', task.user_id, '訂閱:', task.subscription.endpoint, '錯誤:', err.message);
      }
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

app.get('/logout', (req, res) => {
  console.log('處理登出請求');
  res.clearCookie('token');
  res.redirect('/login');
});

app.use((err, req, res, next) => {
  console.error('Global Error:', err.message);
  res.status(500).json({ success: false, error: '伺服器內部錯誤' });
});

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));