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
## Netdata設置
- 使用 dnf 安裝 wget
sudo dnf install -y wget
- 下載並執行最新腳本
DISABLE_TELEMETRY=1 wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh && sh /tmp/netdata-kickstart.sh --release-channel stable
- 確認服務狀態
sudo systemctl status netdata
- 啟動並設置開機啟動
sudo systemctl start netdata
sudo systemctl enable netdata
- 添加防火牆規則
sudo firewall-cmd --permanent --add-port=19999/tcp
sudo firewall-cmd --reload
- 檢查防火牆
sudo firewall-cmd --list-all
- 關閉SElinux
setenforce 0 && getenforce && sed "s#SELINUX=enforcing#SELINUX=disabled#g" /etc/selinux/config -i 
- 配置 Fail2Ban 保護 Netdata
sudo vi /etc/fail2ban/jail.d/netdata.local
```
[netdata]
enabled = true
port = 19999
logpath = /var/log/netdata/access.log
maxretry = 5
bantime = 3600
findtime = 600
backend = auto
```
- 重啟 Fail2Ban
sudo systemctl restart fail2ban
- 能打開監控頁面
IP:19999
## 資源監控腳本
- 安裝 sysstat（提供 iostat）和 bc
sudo dnf install -y sysstat bc
- 啟動 sysstat 服務（確保 iostat 數據可用）
sudo systemctl enable --now sysstat
- 將腳本保存到 /var/process
sudo vi /var/process
```
#!/bin/bash

# 腳本使用 bc 進行浮點數比較。需安裝
# apt install bc -y
# 用於監控 IO 使用率，屬於 sysstat 包。需安裝
# apt install sysstat -y

# TG 机器人 token
TOKEN="5203692206:AAFG0RMH8VubUXQvIHrYm0CKM2uT8DlhSeQ"
# 用户 ID 或频道、群 ID
chat_ID="-4941586070"
# API 接口
URL="https://api.telegram.org/bot${TOKEN}/sendMessage"
# 解析模式
MODE="HTML"

# 收集服務器資訊
HOSTNAME=$(hostname)
IP=$(ip addr show | grep -w inet | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)  # 獲取內網或外網 IP

# 阈值（可根据需求调整）
CPU_THRESHOLD=50
MEM_THRESHOLD=80
DISK_THRESHOLD=90
IO_THRESHOLD=50

# 監控超過阈值的計數器
CPU_EXCEED_COUNT=0
MEM_EXCEED_COUNT=0
DISK_EXCEED_COUNT=0
IO_EXCEED_COUNT=0
CHECK_INTERVAL=60  # 每60秒檢查一次

while true; do
    # 收集當前系統資訊
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    CPU_USAGE=$(top -bn1 | grep '%Cpu(s)' | awk '{printf "%.2f", $2}')
    MEM_USAGE=$(free -m | awk '/Mem:/ {print $3/$2 * 100.0}')
    DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    IO_USAGE=$(iostat -dx | grep sda | awk '{print $NF}')
    TOP_PROCESSES=$(ps -eo pid,ppid,%cpu,%mem,cmd --sort=-%cpu,-%mem | head -n 6 | awk 'NR>1 {printf "%s (PID: %s, CPU: %s%%, MEM: %s%%)\n", $5, $1, $3, $4}')

    # 檢查各項指標是否超過閾值
    ALERT_MESSAGE=""
    
    # CPU 檢查
    if (( $(echo "$CPU_USAGE > $CPU_THRESHOLD" | bc -l) )); then
        ((CPU_EXCEED_COUNT++))
        if [ $CPU_EXCEED_COUNT -ge 5 ]; then
            ALERT_MESSAGE="${ALERT_MESSAGE}<b>CPU 使用率異常</b>: ${CPU_USAGE}% (超過 ${CPU_THRESHOLD}% 持續5分鐘)\n"
        fi
    else
        CPU_EXCEED_COUNT=0
    fi

    # 記憶體檢查
    if (( $(echo "$MEM_USAGE > $MEM_THRESHOLD" | bc -l) )); then
        ((MEM_EXCEED_COUNT++))
        if [ $MEM_EXCEED_COUNT -ge 5 ]; then
            ALERT_MESSAGE="${ALERT_MESSAGE}<b>記憶體使用異常</b>: ${MEM_USAGE}% (超過 ${MEM_THRESHOLD}% 持續5分鐘)\n"
        fi
    else
        MEM_EXCEED_COUNT=0
    fi

    # 磁碟檢查
    if (( $(echo "$DISK_USAGE > $DISK_THRESHOLD" | bc -l) )); then
        ((DISK_EXCEED_COUNT++))
        if [ $DISK_EXCEED_COUNT -ge 5 ]; then
            ALERT_MESSAGE="${ALERT_MESSAGE}<b>磁碟使用異常</b>: ${DISK_USAGE}% (超過 ${DISK_THRESHOLD}% 持續5分鐘)\n"
        fi
    else
        DISK_EXCEED_COUNT=0
    fi

    # IO 檢查
    if (( $(echo "$IO_USAGE > $IO_THRESHOLD" | bc -l) )); then
        ((IO_EXCEED_COUNT++))
        if [ $IO_EXCEED_COUNT -ge 5 ]; then
            ALERT_MESSAGE="${ALERT_MESSAGE}<b>IO 使用異常</b>: ${IO_USAGE}% (超過 ${IO_THRESHOLD}% 持續5分鐘)\n"
        fi
    else
        IO_EXCEED_COUNT=0
    fi

    # 如果有任何異常，發送通知
    if [ -n "$ALERT_MESSAGE" ]; then
        message_text="
        <b>服務器監控通知</b>
        <b>主機名</b>: ${HOSTNAME}
        <b>IP</b>: ${IP}
        <b>時間</b>: ${TIMESTAMP}
        ${ALERT_MESSAGE}
        <b>當前系統狀態</b>:
        CPU 使用率: ${CPU_USAGE}%
        記憶體使用: ${MEM_USAGE}%
        磁碟使用: ${DISK_USAGE}%
        IO使用: ${IO_USAGE}%
        <b>佔用最高的5個程序</b>:
        ${TOP_PROCESSES}
        "

        # 發送 Telegram 通知
        curl -s -X POST "$URL" -d chat_id="${chat_ID}" -d parse_mode="${MODE}" -d text="${message_text}"

        # 重置所有計數器
        CPU_EXCEED_COUNT=0
        MEM_EXCEED_COUNT=0
        DISK_EXCEED_COUNT=0
        IO_EXCEED_COUNT=0
    fi

    sleep $CHECK_INTERVAL
done
```
- 設置執行權限：
sudo chmod +x /var/process
- 創建 systemd 服務文件
sudo vi /etc/systemd/system/process-monitor.service
```
[Unit]
Description=System Monitor with Telegram Notifications
After=network.target sysstat.service

[Service]
ExecStart=/var/process
Restart=always
User=root
WorkingDirectory=/var
StandardOutput=append:/var/log/process-monitor.log
StandardError=append:/var/log/process-monitor.log

[Install]
WantedBy=multi-user.target
```
- 啟用並啟動服務
sudo systemctl daemon-reload
sudo systemctl enable process-monitor.service
sudo systemctl start process-monitor.service
- [可選擇]壓力測試了解腳本運作
stress-ng --vm 100 --vm-bytes 100% --timeout 600s --metrics-brief


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
