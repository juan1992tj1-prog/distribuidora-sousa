@echo off
chcp 65001 >nul
title Distribuidora Sousa - modo demonstracao
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao foi encontrado.
  echo  Instale pelo site nodejs.org ^(Instalador Windows .msi^) e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)
echo Node.js encontrado:
node -v

if not exist "node_modules" echo Primeira vez: instalando dependencias, leva 1 a 3 minutos...
(
  echo.
  echo Conferindo dependencias...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Erro ao instalar as dependencias. Tire um print desta janela.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando o sistema... o navegador vai abrir sozinho em alguns segundos.
start "" cmd /c "timeout /t 25 /nobreak >nul & start http://localhost:3000"
call npm.cmd run demo
pause
