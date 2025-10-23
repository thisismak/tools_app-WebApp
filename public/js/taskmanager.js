let tasks = [];
const notifiedTasks = new Set();

function urlBase64ToUint8Array(base64String) {
  try {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  } catch (err) {
    console.error('VAPID 公鑰轉換失敗:', err);
    throw new Error('無效的 VAPID 公鑰');
  }
}

function checkNotificationPermission() {
  console.log('檢查通知權限，當前狀態:', Notification.permission);
  if (Notification.permission === 'granted') {
    console.log('通知權限已授予，開始訂閱推送');
    subscribeToPush();
  } else if (Notification.permission !== 'denied') {
    console.log('請求通知權限');
    alert('請啟用通知以接收任務到期提醒！');
    Notification.requestPermission().then(permission => {
      console.log('通知權限請求結果:', permission);
      if (permission === 'granted') {
        subscribeToPush();
      } else {
        console.warn('用戶拒絕通知權限:', permission);
        alert('您已拒絕通知權限，無法接收任務提醒。請在瀏覽器設置中啟用通知。');
      }
    }).catch(err => {
      console.error('通知權限請求錯誤:', err);
      alert('請求通知權限失敗，請重試或檢查瀏覽器設置。');
    });
  } else {
    console.warn('通知權限已被拒絕:', Notification.permission);
    alert('通知權限已被拒絕，請在瀏覽器設置中啟用以接收任務提醒。');
  }
}

function subscribeToPush() {
  console.log('開始訂閱推送通知流程');
  if (!('serviceWorker' in navigator && 'PushManager' in window)) {
    console.warn('瀏覽器不支援推送通知或 Service Worker');
    alert('您的瀏覽器不支援推送通知，無法接收任務提醒。');
    return;
  }
  navigator.serviceWorker.ready.then(registration => {
    console.log('Service Worker 準備就緒，註冊狀態:', registration.active?.state);
    registration.pushManager.getSubscription().then(existingSubscription => {
      if (existingSubscription) {
        console.log('發現現有推送訂閱:', existingSubscription.endpoint);
        saveSubscriptionToServer(existingSubscription);
        return;
      }
      console.log('無現有訂閱，創建新訂閱');
      const vapidKey = document.querySelector('script[data-vapid-key]')?.dataset.vapidKey;
      console.log('使用 VAPID 公鑰:', vapidKey ? vapidKey.substring(0, 20) + '...' : '未找到 VAPID 公鑰');
      console.log('嘗試訂閱推送，VAPID 公鑰是否有效:', !!vapidKey);
      if (!vapidKey) {
        console.error('VAPID 公鑰未正確載入');
        alert('推送功能初始化失敗，請重新載入頁面');
        return;
      }
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      }).then(subscription => {
        console.log('新推送訂閱創建成功:', subscription.endpoint);
        saveSubscriptionToServer(subscription);
      }).catch(err => {
        console.error('創建推送訂閱失敗:', err);
        alert('創建推送訂閱失敗: ' + err.message);
      });
    }).catch(err => {
      console.error('獲取現有訂閱失敗:', err);
      alert('獲取推送訂閱失敗，請重試或檢查瀏覽器設置。');
    });
  }).catch(err => {
    console.error('Service Worker 未準備就緒:', err);
    alert('Service Worker 初始化失敗，請重新載入頁面');
  });
}

function saveSubscriptionToServer(subscription) {
  console.log('儲存訂閱到伺服器:', subscription?.endpoint);
  console.log('發送訂閱請求，包含 Cookie:', document.cookie);
  fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': document.cookie },
    body: JSON.stringify(subscription)
  }).then(response => {
    console.log('訂閱儲存請求響應狀態:', response.status);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }).then(data => {
    console.log('訂閱儲存響應數據:', data);
    if (data.success) {
      console.log('推送訂閱儲存成功');
      alert('推送通知訂閱成功！您將收到任務到期提醒。');
    } else {
      console.error('推送訂閱儲存失敗:', data.error);
      alert('推送訂閱儲存失敗: ' + (data.error || '未知錯誤'));
    }
  }).catch(err => {
    console.error('推送訂閱儲存錯誤:', err);
    alert('推送訂閱儲存失敗: ' + err.message + '\n請檢查網路連線或重新載入頁面。');
  });
}

function formatDateTime(date, time) {
  if (!date || !time) {
    throw new Error('日期和時間不能為空');
  }
  try {
    const dateTime = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', 'Asia/Hong_Kong');
    if (!dateTime.isValid()) {
      throw new Error('無效的日期時間格式');
    }
    if (dateTime.isBefore(moment())) {
      throw new Error('到期時間必須是未來時間');
    }
    const formatted = dateTime.format('YYYY-MM-DDTHH:mm:ss.SSSZ');
    console.log('格式化日期時間:', {
      input: `${date} ${time}`,
      output: formatted,
      timezone: dateTime.tz()
    });
    return formatted;
  } catch (err) {
    console.error('日期格式化錯誤:', err);
    throw new Error('日期時間格式化失敗: ' + err.message);
  }
}

function formatDisplayDateTime(datetime) {
  if (typeof moment === 'undefined') {
    console.error('Moment.js 未載入');
    throw new Error('日期處理庫未載入');
  }
  const formatted = moment(datetime).tz('Asia/Hong_Kong').format('YYYY-MM-DD HH:mm');
  console.log(`格式化顯示時間: ${datetime} -> ${formatted}`);
  return formatted;
}

function loadTasks() {
  fetch('/taskmanager/tasks')
    .then(response => response.json())
    .then(data => {
      tasks = Array.isArray(data) ? data : [];
      displayTaskList();
      renderCalendar();
    })
    .catch(() => {
      tasks = [];
      displayTaskList();
      renderCalendar();
    });
}

function displayTaskList() {
  const taskList = document.getElementById('taskList');
  if (!taskList) {
    console.error('任務列表元素未找到');
    return;
  }
  taskList.innerHTML = '';
  if (!Array.isArray(tasks) || tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'list-group-item text-center';
    li.textContent = '暫無任務';
    taskList.appendChild(li);
    return;
  }
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center';
    li.innerHTML = `
           <div>
             <strong>${escapeHtml(String(task.title || ''))}</strong> - ${escapeHtml(String(task.description || '無描述'))} (到期: ${formatDisplayDateTime(task.due_date)})
           </div>
           <div>
             <button class="btn btn-sm btn-warning mx-1" onclick="editTask(${task.id})">編輯</button>
             <button class="btn btn-sm btn-danger" onclick="deleteTask(${task.id})">刪除</button>
           </div>
         `;
    taskList.appendChild(li);
  });
}

function renderCalendar(attempt = 1) {
  if (typeof FullCalendar === 'undefined') {
    console.error(`FullCalendar 未載入，嘗試次數: ${attempt}`);
    if (attempt < 3) {
      console.log(`重試 renderCalendar，次數: ${attempt + 1}`);
      setTimeout(() => renderCalendar(attempt + 1), 2000);
      return;
    }
    alert('日曆功能載入失敗，請重新載入頁面');
    return;
  }
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) {
    console.error('日曆元素未找到');
    return;
  }
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    timeZone: 'Asia/Hong_Kong',
    events: Array.isArray(tasks) ? tasks.map(task => ({
      title: task.title,
      start: moment(task.due_date).tz('Asia/Hong_Kong').format('YYYY-MM-DDTHH:mm:ssZ'),
      allDay: false,
      backgroundColor: '#FFFF00',
      borderColor: '#FFFF00',
      textColor: '#000000'
    })) : [],
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }
  });
  calendar.render();
}

function saveTask() {
  const id = document.getElementById('taskId')?.value;
  const title = document.getElementById('title')?.value.trim();
  const description = document.getElementById('description')?.value.trim();
  const dueDate = document.getElementById('dueDate')?.value;
  const dueTime = document.getElementById('dueTime')?.value;

  if (!title || !dueDate || !dueTime) {
    alert('請填寫標題、到期日期和到期時間！');
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{2}:\d{2}$/.test(dueTime)) {
    alert('請輸入有效的日期（YYYY-MM-DD）和時間（HH:mm）格式！');
    return;
  }

  try {
    const dueDateTime = moment.tz(`${dueDate} ${dueTime}`, 'YYYY-MM-DD HH:mm', 'Asia/Hong_Kong')
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    const payload = {
      title,
      description: description || '',
      due_date: dueDateTime
    };

    console.log('儲存任務請求數據:', payload);

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/taskmanager/edit/${id}` : '/taskmanager/add';

    fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': document.cookie // 確保帶上 JWT
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
      .then(response => {
        console.log('儲存任務響應狀態:', response.status, response.statusText);
        if (!response.ok) {
          return response.json().then(data => {
            throw new Error(`HTTP ${response.status}: ${data.error || response.statusText}`);
          });
        }
        return response.json();
      })
      .then(data => {
        console.log('儲存任務響應數據:', data);
        if (!data || typeof data !== 'object') {
          throw new Error('無效的響應數據');
        }
        if (!data.success) {
          throw new Error(data.error || '儲存失敗');
        }
        loadTasks();
        resetForm();
        alert('任務已儲存！');
      })
      .catch(err => {
        console.error('儲存任務錯誤:', err.message, err.stack);
        alert('儲存任務失敗: ' + err.message);
      });
  } catch (err) {
    console.error('請求準備失敗:', err.message, err.stack);
    alert('請求準備失敗: ' + err.message);
  }
}

function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) {
    console.warn('未找到任務:', id);
    alert('無法編輯任務，任務不存在');
    return;
  }
  const taskIdEl = document.getElementById('taskId');
  const titleEl = document.getElementById('title');
  const descriptionEl = document.getElementById('description');
  const dueDateEl = document.getElementById('dueDate');
  const dueTimeEl = document.getElementById('dueTime');
  if (!taskIdEl || !titleEl || !descriptionEl || !dueDateEl || !dueTimeEl) {
    console.error('表單元素未找到');
    alert('編輯表單載入失敗，請重新載入');
    return;
  }
  taskIdEl.value = task.id;
  titleEl.value = task.title;
  descriptionEl.value = task.description || '';
  const dueDateTime = moment(task.due_date).tz('Asia/Hong_Kong');
  dueDateEl.value = dueDateTime.format('YYYY-MM-DD');
  dueTimeEl.value = dueDateTime.format('HH:mm');
}

function deleteTask(id) {
  if (!confirm('確定要刪除此任務嗎？')) {
    console.log('用戶取消刪除任務:', id);
    return;
  }
  fetch(`/taskmanager/delete/${id}`, {
    method: 'DELETE',
    headers: { 'Cookie': document.cookie }
  })
    .then(response => {
      console.log('刪除任務響應狀態:', response.status);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('刪除任務響應數據:', data);
      if (data.success) {
        console.log('任務刪除成功:', id);
        loadTasks();
      } else {
        console.error('任務刪除失敗:', data.error);
        alert(data.error || '刪除任務失敗');
      }
    })
    .catch(err => {
      console.error('刪除任務錯誤:', err);
      alert('刪除任務失敗: ' + err.message);
    });
}

function resetForm() {
  const form = document.getElementById('taskForm');
  const taskIdEl = document.getElementById('taskId');
  if (!form || !taskIdEl) {
    console.error('表單或任務ID元素未找到');
    return;
  }
  form.reset();
  taskIdEl.value = '';
}

function checkUpcomingTasks() {
  if (typeof moment === 'undefined') {
    console.error('Moment.js 未載入，無法檢查即將到期任務');
    return;
  }
  if (!Array.isArray(tasks)) {
    console.warn('任務列表無效，跳過即將到期檢查');
    return;
  }
  const now = moment().tz('Asia/Hong_Kong');
  tasks.forEach(task => {
    if (!task.due_date || !moment(task.due_date).isValid()) {
      console.warn('任務到期日期無效:', task.id, task.title, task.due_date);
      return;
    }
    const dueDateTime = moment(task.due_date).tz('Asia/Hong_Kong');
    const diffMinutes = dueDateTime.diff(now, 'minutes');
    if (diffMinutes > 0 && diffMinutes <= 5 && !notifiedTasks.has(task.id)) {
      console.log('即將到期任務:', task.title, '剩餘分鐘:', diffMinutes);
      alert(`任務 "${task.title}" 將於 ${dueDateTime.format('YYYY-MM-DD HH:mm')} 到期！`);
      notifiedTasks.add(task.id);
    }
  });
}

// 小工具：簡單轉義避免內嵌 HTML 注入
function escapeHtml(str) {
  return str.replace(/[&<>"'`=\/]/g, function (s) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    })[s];
  });
}

// 掛到全域，確保在 EJS 中可以檢查與呼叫
window.loadTasks = loadTasks;
window.checkNotificationPermission = checkNotificationPermission;
window.checkUpcomingTasks = checkUpcomingTasks;
window.saveTask = saveTask;
window.editTask = editTask;
window.deleteTask = deleteTask;
window.resetForm = resetForm;

// 在這裡綁定 DOMContentLoaded 事件，確保頁面元素已載入
document.addEventListener('DOMContentLoaded', function () {
  console.log('DOMContentLoaded 事件觸發，FullCalendar 狀態:', typeof FullCalendar);
  console.log('初始化時檢查通知權限');
  checkNotificationPermission();
  try {
    if (typeof loadTasks !== 'function') {
      console.warn('loadTasks 未定義，將略過載入。');
    } else {
      loadTasks();
    }
  } catch (err) {
    console.error('任務管理頁面初始化錯誤:', err);
  }
});