require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const moment = require('moment-timezone'); // 加入 moment-timezone
const app = express();

// 設定 Node.js 時區為香港（UTC+8）
process.env.TZ = 'Asia/Hong_Kong';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));
app.set('view engine', 'ejs');

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
  timezone: '+08:00' // 設定 MySQL 連線為 UTC+8
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

// 創建生字庫表
pool.query(`CREATE TABLE IF NOT EXISTS wordlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`, (err) => {
  if (err) {
    console.error('Wordlists Table Creation Error:', err.message);
    throw err;
  }
  console.log('Wordlists table ready');
});

// 創建生字表
pool.query(`CREATE TABLE IF NOT EXISTS words (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wordlist_id INT NOT NULL,
  english VARCHAR(255) NOT NULL,
  chinese VARCHAR(255) NOT NULL,
  FOREIGN KEY (wordlist_id) REFERENCES wordlists(id)
)`, (err) => {
  if (err) {
    console.error('Words Table Creation Error:', err.message);
    throw err;
  }
  console.log('Words table ready');
});

// 創建任務表
pool.query(`CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`, (err) => {
  if (err) {
    console.error('Tasks Table Creation Error:', err.message);
    throw err;
  }
  console.log('Tasks table ready');
});

// 根路徑渲染首頁
app.get('/', (req, res) => res.render('index'));

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

// 登出路由
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// JWT 中間件
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
      return res.render('dashboard', { username: '未知' });
    }
    res.render('dashboard', { username: results[0].username });
  });
});

// 背默英文生字頁面
app.get('/dictation', verifyToken, (req, res) => {
  pool.query('SELECT id, name FROM wordlists WHERE user_id = ?', [req.user.id], (err, results) => {
    if (err) {
      console.error('Wordlists Query Error:', err.message);
      return res.render('dictation', { wordlists: [] });
    }
    res.render('dictation', { wordlists: results });
  });
});

// API：儲存生字庫
app.post('/dictation/save', verifyToken, (req, res) => {
  const { wordlistName, words } = req.body;
  if (!wordlistName || !words || !Array.isArray(words)) {
    return res.status(400).json({ error: '請提供生字庫名稱和有效的生字列表' });
  }

  pool.query('INSERT INTO wordlists (user_id, name) VALUES (?, ?)', [req.user.id, wordlistName], (err, result) => {
    if (err) {
      console.error('Wordlist Insert Error:', err.message);
      return res.status(500).json({ error: '儲存生字庫失敗' });
    }
    const wordlistId = result.insertId;
    const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
    pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues], (err) => {
      if (err) {
        console.error('Words Insert Error:', err.message);
        return res.status(500).json({ error: '儲存生字失敗' });
      }
      res.json({ success: true, wordlistId });
    });
  });
});

// API：取得指定生字庫的生字
app.get('/dictation/words/:wordlistId', verifyToken, (req, res) => {
  const wordlistId = req.params.wordlistId;
  pool.query('SELECT id, english, chinese FROM words WHERE wordlist_id = ?', [wordlistId], (err, results) => {
    if (err) {
      console.error('Words Query Error:', err.message);
      return res.status(500).json({ error: '取得生字失敗' });
    }
    res.json(results);
  });
});

// API：刪除生字庫
app.delete('/dictation/wordlist/:wordlistId', verifyToken, (req, res) => {
  const wordlistId = req.params.wordlistId;
  pool.query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId], (err) => {
    if (err) {
      console.error('Words Delete Error:', err.message);
      return res.status(500).json({ error: '刪除生字失敗' });
    }
    pool.query('DELETE FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, req.user.id], (err) => {
      if (err) {
        console.error('Wordlist Delete Error:', err.message);
        return res.status(500).json({ error: '刪除生字庫失敗' });
      }
      res.json({ success: true });
    });
  });
});

// API：更新生字庫中的生字
app.put('/dictation/words/:wordlistId', verifyToken, (req, res) => {
  const wordlistId = req.params.wordlistId;
  const words = req.body.words;
  if (!words || !Array.isArray(words)) {
    return res.status(400).json({ error: '請提供有效的生字列表' });
  }

  pool.query('DELETE FROM words WHERE wordlist_id = ?', [wordlistId], (err) => {
    if (err) {
      console.error('Words Delete Error:', err.message);
      return res.status(500).json({ error: '更新生字失敗' });
    }
    if (words.length > 0) {
      const wordValues = words.map(word => [wordlistId, word.english, word.chinese]);
      pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES ?', [wordValues], (err) => {
        if (err) {
          console.error('Words Insert Error:', err.message);
          return res.status(500).json({ error: '更新生字失敗' });
        }
        res.json({ success: true });
      });
    } else {
      res.json({ success: true });
    }
  });
});

// API：新增單個生字
app.post('/dictation/word/:wordlistId', verifyToken, (req, res) => {
  const wordlistId = req.params.wordlistId;
  const { english, chinese } = req.body;
  if (!english || !chinese) {
    return res.status(400).json({ error: '請提供英文和中文解釋' });
  }

  pool.query('SELECT * FROM wordlists WHERE id = ? AND user_id = ?', [wordlistId, req.user.id], (err, results) => {
    if (err || results.length === 0) {
      console.error('Wordlist Check Error:', err?.message || '無效的生字庫');
      return res.status(403).json({ error: '無效的生字庫或無權限' });
    }

    pool.query('INSERT INTO words (wordlist_id, english, chinese) VALUES (?, ?, ?)', 
      [wordlistId, english, chinese], 
      (err, result) => {
        if (err) {
          console.error('Word Insert Error:', err.message);
          return res.status(500).json({ error: '新增生字失敗' });
        }
        res.json({ success: true, wordId: result.insertId });
      }
    );
  });
});

// 任務管理頁面
app.get('/taskmanager', verifyToken, (req, res) => {
  res.render('taskmanager');
});

// API：取得用戶的所有任務
app.get('/taskmanager/tasks', verifyToken, (req, res) => {
  pool.query('SELECT * FROM tasks WHERE user_id = ?', [req.user.id], (err, results) => {
    if (err) {
      console.error('Tasks Query Error:', err.message);
      return res.status(500).json({ error: '取得任務失敗' });
    }
    const formattedResults = results.map(task => ({
      ...task,
      due_date: moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DDTHH:mm:ssZ')
    }));
    console.log('傳送至前端的任務:', formattedResults); // 記錄傳送的任務
    res.json(formattedResults);
  });
});

// API：新增任務
app.post('/taskmanager/add', verifyToken, (req, res) => {
  const { title, description, due_date } = req.body;
  if (!title || !due_date) {
    return res.status(400).json({ error: '請提供標題和到期日期' });
  }
  const formattedDueDate = moment.tz(due_date, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  console.log('儲存任務的到期時間:', formattedDueDate); // 記錄到期時間
  pool.query('INSERT INTO tasks (user_id, title, description, due_date) VALUES (?, ?, ?, ?)',
    [req.user.id, title, description, formattedDueDate],
    (err, result) => {
      if (err) {
        console.error('Task Insert Error:', err.message);
        return res.status(500).json({ error: '新增任務失敗' });
      }
      res.json({ success: true, taskId: result.insertId });
    }
  );
});

// API：編輯任務
app.put('/taskmanager/edit/:id', verifyToken, (req, res) => {
  const taskId = req.params.id;
  const { title, description, due_date } = req.body;
  if (!title || !due_date) {
    return res.status(400).json({ error: '請提供標題和到期日期' });
  }
  const formattedDueDate = moment.tz(due_date, 'Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss');
  console.log('更新任務的到期時間:', formattedDueDate); // 記錄到期時間
  pool.query('UPDATE tasks SET title = ?, description = ?, due_date = ? WHERE id = ? AND user_id = ?',
    [title, description, formattedDueDate, taskId, req.user.id],
    (err) => {
      if (err) {
        console.error('Task Update Error:', err.message);
        return res.status(500).json({ error: '編輯任務失敗' });
      }
      res.json({ success: true });
    }
  );
});

// API：刪除任務
app.delete('/taskmanager/delete/:id', verifyToken, (req, res) => {
  const taskId = req.params.id;
  pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id], (err) => {
    if (err) {
      console.error('Task Delete Error:', err.message);
      return res.status(500).json({ error: '刪除任務失敗' });
    }
    res.json({ success: true });
  });
});

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));