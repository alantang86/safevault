import http.server
import socketserver
import json
import sqlite3
import os
import sys
import webbrowser
import threading
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("VAULT_PORT", 19527))
DB_DIR = os.environ.get("VAULT_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DB_FILE = os.path.join(DB_DIR, "passwords_vault.db")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # 存储系统配置信息（例如安全参数验证散列、加盐）
    c.execute('''
        CREATE TABLE IF NOT EXISTS vault_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    # 存储密码条目：端到端加密零知识存储
    # encrypted_payload 存放加密后的详细数据（账号、密码、二次验证码、自定义键值对、备注等）
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL,       -- login, website, card, server, app, wifi, secret
            category TEXT,           -- 工作, 个人, 社交, 金融, 服务器 等
            username_preview TEXT,   -- 方便检索/列表显示的明文或脱敏预览
            website_url TEXT,
            encrypted_payload TEXT NOT NULL, -- AES-GCM-256 加密密文 (包含 iv, ciphertext)
            is_favorite INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

class VaultAPIHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/status':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT value FROM vault_meta WHERE key = "vault_initialized"')
            row = c.fetchone()
            c.execute('SELECT value FROM vault_meta WHERE key = "salt"')
            salt_row = c.fetchone()
            c.execute('SELECT value FROM vault_meta WHERE key = "verifier"')
            verifier_row = c.fetchone()
            c.execute('SELECT COUNT(*) FROM entries')
            count = c.fetchone()[0]
            conn.close()

            initialized = (row is not None and row[0] == 'true')
            return self._send_json(200, {
                'initialized': initialized,
                'salt': salt_row[0] if salt_row else None,
                'verifier': verifier_row[0] if verifier_row else None,
                'total_entries': count
            })

        elif path == '/api/entries':
            query = parse_qs(parsed.query)
            cat = query.get('category', [None])[0]
            etype = query.get('type', [None])[0]
            fav = query.get('favorite', [None])[0]
            search = query.get('q', [None])[0]

            sql = 'SELECT id, title, type, category, username_preview, website_url, encrypted_payload, is_favorite, created_at, updated_at FROM entries WHERE 1=1'
            params = []
            if cat and cat != 'all':
                sql += ' AND category = ?'
                params.append(cat)
            if etype and etype != 'all':
                sql += ' AND type = ?'
                params.append(etype)
            if fav == '1':
                sql += ' AND is_favorite = 1'
            if search:
                sql += ' AND (title LIKE ? OR username_preview LIKE ? OR website_url LIKE ?)'
                wild = f'%{search}%'
                params.extend([wild, wild, wild])

            sql += ' ORDER BY is_favorite DESC, updated_at DESC'

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute(sql, params)
            rows = c.fetchall()
            conn.close()

            entries = []
            for r in rows:
                entries.append({
                    'id': r[0],
                    'title': r[1],
                    'type': r[2],
                    'category': r[3],
                    'username_preview': r[4],
                    'website_url': r[5],
                    'encrypted_payload': r[6],
                    'is_favorite': bool(r[7]),
                    'created_at': r[8],
                    'updated_at': r[9]
                })
            return self._send_json(200, {'entries': entries})

        elif path == '/api/export':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('SELECT key, value FROM vault_meta')
            meta = dict(c.fetchall())
            c.execute('SELECT id, title, type, category, username_preview, website_url, encrypted_payload, is_favorite, created_at, updated_at FROM entries')
            rows = c.fetchall()
            conn.close()

            entries = []
            for r in rows:
                entries.append({
                    'id': r[0],
                    'title': r[1],
                    'type': r[2],
                    'category': r[3],
                    'username_preview': r[4],
                    'website_url': r[5],
                    'encrypted_payload': r[6],
                    'is_favorite': r[7],
                    'created_at': r[8],
                    'updated_at': r[9]
                })

            return self._send_json(200, {
                'version': 1,
                'meta': meta,
                'entries': entries
            })

        # 默认静态页面路由
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            payload = json.loads(body.decode('utf-8'))
        except Exception:
            return self._send_json(400, {'error': '无效的 JSON 格式'})

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()

        if path == '/api/init':
            # 初始化保险库主密码验证数据
            salt = payload.get('salt')
            verifier = payload.get('verifier')
            if not salt or not verifier:
                conn.close()
                return self._send_json(400, {'error': '缺少 salt 或 verifier'})

            c.execute('INSERT OR REPLACE INTO vault_meta (key, value) VALUES ("vault_initialized", "true")')
            c.execute('INSERT OR REPLACE INTO vault_meta (key, value) VALUES ("salt", ?)', (salt,))
            c.execute('INSERT OR REPLACE INTO vault_meta (key, value) VALUES ("verifier", ?)', (verifier,))
            conn.commit()
            conn.close()
            return self._send_json(200, {'success': True, 'message': '密码库初始化完成'})

        elif path == '/api/entries':
            # 新建条目
            entry_id = payload.get('id')
            title = payload.get('title', '').strip()
            etype = payload.get('type', 'login')
            category = payload.get('category', '默认')
            username_preview = payload.get('username_preview', '')
            website_url = payload.get('website_url', '')
            encrypted_payload = payload.get('encrypted_payload')
            is_favorite = 1 if payload.get('is_favorite') else 0

            if not entry_id or not title or not encrypted_payload:
                conn.close()
                return self._send_json(400, {'error': '缺少必要字段 (id, title, encrypted_payload)'})

            c.execute('''
                INSERT INTO entries (id, title, type, category, username_preview, website_url, encrypted_payload, is_favorite, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (entry_id, title, etype, category, username_preview, website_url, encrypted_payload, is_favorite))
            conn.commit()
            conn.close()
            return self._send_json(201, {'success': True, 'id': entry_id})

        elif path == '/api/entries/batch':
            # 批量导入
            entries = payload.get('entries', [])
            count = 0
            for item in entries:
                if 'id' in item and 'title' in item and 'encrypted_payload' in item:
                    c.execute('''
                        INSERT OR REPLACE INTO entries (id, title, type, category, username_preview, website_url, encrypted_payload, is_favorite, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ''', (
                        item['id'],
                        item['title'],
                        item.get('type', 'login'),
                        item.get('category', '默认'),
                        item.get('username_preview', ''),
                        item.get('website_url', ''),
                        item['encrypted_payload'],
                        1 if item.get('is_favorite') else 0
                    ))
                    count += 1
            conn.commit()
            conn.close()
            return self._send_json(200, {'success': True, 'count': count})

        elif path == '/api/reset':
            # 清空密码库重置
            c.execute('DELETE FROM entries')
            c.execute('DELETE FROM vault_meta')
            conn.commit()
            conn.close()
            return self._send_json(200, {'success': True, 'message': '已重置密码库'})

        conn.close()
        return self._send_json(404, {'error': '接口不存在'})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/entries/'):
            entry_id = path.replace('/api/entries/', '')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else b'{}'
            try:
                payload = json.loads(body.decode('utf-8'))
            except Exception:
                return self._send_json(400, {'error': '无效的 JSON 格式'})

            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()

            # 支持更新收藏状态或者完整更新
            if 'is_favorite' in payload and len(payload) == 1:
                c.execute('UPDATE entries SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                          (1 if payload['is_favorite'] else 0, entry_id))
            else:
                title = payload.get('title', '').strip()
                etype = payload.get('type', 'login')
                category = payload.get('category', '默认')
                username_preview = payload.get('username_preview', '')
                website_url = payload.get('website_url', '')
                encrypted_payload = payload.get('encrypted_payload')
                is_favorite = 1 if payload.get('is_favorite') else 0

                c.execute('''
                    UPDATE entries 
                    SET title = ?, type = ?, category = ?, username_preview = ?, website_url = ?, encrypted_payload = ?, is_favorite = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (title, etype, category, username_preview, website_url, encrypted_payload, is_favorite, entry_id))

            conn.commit()
            conn.close()
            return self._send_json(200, {'success': True})

        return self._send_json(404, {'error': '接口不存在'})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/entries/'):
            entry_id = path.replace('/api/entries/', '')
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('DELETE FROM entries WHERE id = ?', (entry_id,))
            conn.commit()
            conn.close()
            return self._send_json(200, {'success': True})

        return self._send_json(404, {'error': '接口不存在'})

def run_server():
    init_db()
    os.makedirs(STATIC_DIR, exist_ok=True)
    
    # 允许端口快速重用
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), VaultAPIHandler) as httpd:
        print(f"=====================================================")
        print(f" 轻量免安装密码管理器 (SafeVault) 服务已启动")
        print(f" 本地访问地址: http://127.0.0.1:{PORT}")
        print(f" 数据库存储文件: {DB_FILE}")
        print(f" 按 Ctrl+C 可停止运行")
        print(f"=====================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n正在安全关闭服务...")
            httpd.server_close()

if __name__ == '__main__':
    # 支持命令行自动拉起浏览器
    if '--open' in sys.argv:
        def open_browser():
            import time
            time.sleep(0.8)
            webbrowser.open(f'http://127.0.0.1:{PORT}')
        threading.Thread(target=open_browser, daemon=True).start()
    run_server()
