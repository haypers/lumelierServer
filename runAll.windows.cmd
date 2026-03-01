@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"

if not exist "%VSDEVCMD%" goto :missing_vs

echo Using Visual Studio dev environment:
echo   %VSDEVCMD%

call "%VSDEVCMD%" -arch=arm64 -host_arch=arm64 >nul
if errorlevel 1 goto :vs_failed

set "FIRST_LINK="
for /f "delims=" %%L in ('where link 2^>nul') do if not defined FIRST_LINK set "FIRST_LINK=%%L"
echo First linker resolved:
echo %FIRST_LINK%
echo %FIRST_LINK% | findstr /I /C:"\Git\usr\bin\link.exe" >nul
if %ERRORLEVEL%==0 goto :bad_linker

cd /d "%SCRIPT_DIR%"
bash ./runAll.windows.sh
exit /b %ERRORLEVEL%

:missing_vs
echo Error: Could not find VsDevCmd.bat.
echo Install Visual Studio 2022 Build Tools with:
echo   - Desktop development with C++
echo   - MSVC v143 ARM64 build tools
echo   - Windows 10/11 SDK
exit /b 1

:vs_failed
echo Error: Failed to initialize Visual Studio developer environment.
exit /b 1

:bad_linker
echo Error: Git linker is still first on PATH. Open a fresh terminal and rerun this script.
exit /b 1
