-- 初始化資料庫結構和預設數據
-- 適用於 internal_website 資料庫，確保與現有系統兼容

-- 創建用戶表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user'
);

-- 檢查並添加 role 欄位（若現有資料庫缺少）
SET @role_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);
SET @sql = IF(@role_exists = 0,
  'ALTER TABLE users ADD COLUMN role ENUM("user", "admin") NOT NULL DEFAULT "user"',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 插入或更新預設管理員帳戶
-- 密碼：admin123（使用 bcrypt 加密）
INSERT INTO users (username, email, password, role) VALUES (
  'admin',
  'admin@mysandshome.com',
  '$2b$10$80gmxoIc6.GiczCNng3fseLqhTn28hOmwjLlFfVDYqpIFhqDGocOW', -- 密碼：admin123
  'admin'
) ON DUPLICATE KEY UPDATE
  password = '$2b$10$80gmxoIc6.GiczCNng3fseLqhTn28hOmwjLlFfVDYqpIFhqDGocOW',
  role = 'admin';

-- 創建生字庫表
CREATE TABLE IF NOT EXISTS wordlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 創建生字表
CREATE TABLE IF NOT EXISTS words (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wordlist_id INT NOT NULL,
  english VARCHAR(255) NOT NULL,
  chinese VARCHAR(255) NOT NULL,
  FOREIGN KEY (wordlist_id) REFERENCES wordlists(id) ON DELETE CASCADE
);

-- 創建任務表
CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_date DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notified BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 創建檔案表
CREATE TABLE IF NOT EXISTS files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  custom_name VARCHAR(255) NOT NULL,
  description TEXT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 創建推送訂閱表
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  subscription JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 創建站點設定表
CREATE TABLE IF NOT EXISTS site_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(255) NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 初始化站點設定（SEO 和系統設定）
INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES
('site_title', '技術人員內部網站'),
('vapid_public_key', 'BCUBSpo6Y0Q8QUKduPAWXSwcvlElJbg5_PZDiXYJf1JC8sS3lCODMs_IiFDahD0LtlimMBqZj1G7lH61eVJMGeY'),
('index_meta_description', '技術人員內部網站，提供英文生字背默、任務管理和檔案管理功能，助力技術人員高效學習和工作。'),
('index_meta_keywords', '技術人員, 英文學習, 生字背默, 任務管理, 檔案管理, PWA應用'),
('index_og_title', '技術人員內部網站 - 高效學習與管理平台'),
('index_og_description', '專為技術人員設計的學習與管理工具，支持英文生字背默、任務管理和檔案管理，提升工作效率。'),
('login_meta_description', '登入技術人員內部網站，管理您的學習和工作任務。'),
('login_meta_keywords', '技術人員, 登入, 學習管理, 任務管理'),
('login_og_title', '技術人員內部網站 - 登入'),
('login_og_description', '登入技術人員內部網站，開始管理您的學習和工作任務。'),
('register_meta_description', '註冊技術人員內部網站，體驗高效的學習與管理工具。'),
('register_meta_keywords', '技術人員, 註冊, 學習管理, PWA應用'),
('register_og_title', '技術人員內部網站 - 註冊'),
('register_og_description', '立即註冊技術人員內部網站，體驗高效的學習與管理工具。');

-- 創建活動日誌表
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(255) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 檢查並添加 tasks 表的 notified 欄位
SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'tasks' AND COLUMN_NAME = 'notified'
);
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE tasks ADD COLUMN notified BOOLEAN DEFAULT FALSE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 初始化現有任務的 notified 狀態
UPDATE tasks SET notified = TRUE WHERE due_date < NOW();

-- 檢查並添加 files 表的 custom_name 和 description 欄位
SET @custom_name_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'custom_name'
);
SET @description_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'description'
);
SET @sql = IF(@custom_name_exists = 0,
  'ALTER TABLE files ADD COLUMN custom_name VARCHAR(255) NOT NULL DEFAULT ""',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql = IF(@description_exists = 0,
  'ALTER TABLE files ADD COLUMN description TEXT',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 為現有檔案設置預設 custom_name（使用 original_name）
UPDATE files SET custom_name = original_name WHERE custom_name IS NULL OR custom_name = '';