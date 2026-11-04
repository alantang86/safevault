@echo off
chcp 65001 >nul
title SafeVault 免安装密码管理器

echo ========================================================
echo        SafeVault 免安装安全密码管理器
echo ========================================================
echo.
echo 正在检查运行环境并启动轻量本地服务...

:: 启动后台本地 Python Web 服务
start /b python server.py

:: 等待服务启动就绪
timeout /t 1 /nobreak >nul

:: 优先以应用窗口模式（App Mode）启动 Edge 浏览器，无边框/原生窗口体验
start msedge --app="http://127.0.0.1:19527" || start http://127.0.0.1:19527

echo 服务已就绪！请在弹出的窗口中使用。
echo 如需关闭服务，关闭此黑窗口即可。
pause
