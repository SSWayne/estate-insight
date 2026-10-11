@echo off
title Estate Insight 雙北購屋分析系統
cd /d "%~dp0"

echo ============================================
echo    Estate Insight  雙北購屋分析系統
echo ============================================
echo.

rem --- 1. 檢查 Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js。
  echo        請先到 https://nodejs.org 下載安裝「LTS」版本，安裝完成後再雙擊本檔案。
  echo.
  pause
  exit /b 1
)

rem --- 2. 已經在執行中：直接開啟瀏覽器 ---
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo 系統已經在執行中，正在開啟瀏覽器...
  start "" "http://localhost:5173/"
  timeout /t 3 >nul
  exit /b 0
)

rem --- 3. 第一次使用：安裝必要元件 ---
if not exist "node_modules\" (
  echo 第一次使用，正在安裝必要元件，需要網路連線，約需 1 分鐘...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [錯誤] 安裝失敗，請確認網路連線後再試一次。
    pause
    exit /b 1
  )
  echo.
)

rem --- 4. 啟動系統並自動開啟瀏覽器 ---
echo 正在啟動系統，瀏覽器會自動開啟 http://localhost:5173
echo.
echo   ※ 使用期間請不要關閉這個視窗；關閉視窗就會停止系統。
echo   ※ 資料存在瀏覽器裡，關閉系統不會遺失資料。
echo   ※ 請固定使用同一個瀏覽器開啟，換瀏覽器會看不到資料。
echo.
call npm run dev -- --open

echo.
echo 系統已停止。若剛才出現錯誤訊息，請截圖保留。
pause
