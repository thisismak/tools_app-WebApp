# Server安裝 (Rocky Linux 9)
## 更新系統
sudo dnf update -y
## 安裝EPEL及
sudo dnf install -y epel-release
sudo dnf module install nodejs:22
## 安裝 Git
sudo dnf install -y git
## 安裝 MariaDB
sudo dnf install -y mariadb-server
sudo systemctl start mariadb
sudo systemctl enable mariadb
sudo mysql_secure_installation
## 建立專案目錄
sudo mkdir -p /opt/tools_app-webapp
cd /opt/tools_app-webapp
## 從 GitHub 克隆程式碼
git clone https://github.com/thisismak/tools_app-WebApp.git .
如果是私有儲存庫，新增認證：git clone https://username:token@github.com/...（使用 Personal Access Token）。
## 登入 MariaDB 並建立資料庫/使用者
sudo mysql -u root -p
## 在 MariaDB 提示符執行
CREATE DATABASE internal_website CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'sam1_sql_password';
GRANT ALL PRIVILEGES ON internal_website.* TO 'app_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
## 安裝 Node.js 依賴
npm install
## 如果出現 bcrypt 編譯錯誤（常見於 Linux），安裝 build 工具
sudo dnf install -y gcc-c++ make
npm install bcryptjs --save
## 全域安裝 PM2
sudo npm install -g pm2
## 啟動應用程式
pm2 start app.js --name "tools_app-webapp"
pm2 save
pm2 startup
## 安裝 Nginx
sudo dnf install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
## 編輯 
vi /etc/nginx/conf.d/tools_app.conf
```
server {
    listen 80;
    server_name tools.mysandshome.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
## 安裝SSL (Let’s encrypt)
a. 安裝 Certbot 和 Nginx 插件
sudo dnf install certbot python3-certbot-nginx -y

b. 驗證 Certbot 安裝
certbot --version

c. 申請 Let's Encrypt SSL 證書
sudo certbot --nginx -d tools.mysandshome.com

d. 檢查Nginx是否已自動導入SSL內容
cat /etc/nginx/conf.d/tools_app.conf

e. 檢查配置
sudo nginx -t

f. 如果沒有錯誤，重啟 Nginx 應用更改
sudo systemctl restart nginx

g. 設置自動續期
sudo certbot renew --dry-run

h. 可以手動添加 Cron 任務
sudo crontab -e
0 0,12 * * * certbot renew --quiet
## 測試並重載
sudo nginx -t
sudo systemctl reload nginx
## 打開網站測試
http://tools.mysandshome.com/login

# 系統安全設置
## firewalld設置
- 啟用並運行 firewalld
systemctl enable --now firewalld
- 開放 HTTP 和 HTTPS 服務
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
- 開放自定義 SSH 端口
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" port port="33888" protocol="tcp" accept'
- 限制 MySQL 端口 (3306)
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="127.0.0.1" port port="3306" protocol="tcp" accept'
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" port port="3306" protocol="tcp" reject'
- 應用防火牆規則
firewall-cmd --reload
- 檢查防火牆配置
firewall-cmd --list-all
## fail2ban(ssh/http)設置
- 安裝 Fail2Ban
dnf install -y fail2ban
- 啟動 Fail2Ban 服務
systemctl start fail2ban
- 設置 Fail2Ban 開機自動啟動
systemctl enable fail2ban
- 創建 Fail2Ban 自定義配置目錄
mkdir -p /etc/fail2ban/jail.d
- 配置 SSH 防護
vi /etc/fail2ban/jail.d/sshd.local
```
[sshd]
enabled = true
port = 33888
maxretry = 3
bantime = 3600
findtime = 600
logpath = /var/log/secure
backend = auto
```
- 檢查ssh記錄是否存在
ls /var/log/secure
- 配置 Nginx HTTP 認證防護
vi /etc/fail2ban/jail.d/nginx-http-auth.local
```
[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
findtime = 600
backend = auto
```
- 重啟 Fail2Ban 服務
systemctl restart fail2ban


# 故障處理需知
## 重啟網站服務方法
pm2 restart tools_app-webapp
systemctl restart nginx

## 常用日誌
tail -n 50 /var/log/nginx/access.log
tail -n 50 /var/log/nginx/error.log
pm2 log tools_app-webapp

## 檢查SQL內容
mysql -u app_user -psam1_sql_password -e "SHOW DATABASES;"
mysql -u app_user -psam1_sql_password -e "SHOW TABLES FROM internal_website;"
mysql -u app_user -psam1_sql_password -e "USE internal_website; SHOW CREATE TABLE users;"
mysql -u app_user -psam1_sql_password -e "USE internal_website; DESC users;"
mysql -u app_user -psam1_sql_password -e "USE internal_website; SELECT * FROM users;"
