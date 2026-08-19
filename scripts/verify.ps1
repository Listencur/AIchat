# 验证脚本 - 阶段7完整验证
# 使用方法: powershell -ExecutionPolicy Bypass -File scripts/verify.ps1

$ErrorActionPreference = "Stop"
$failed = 0

Write-Host "=== 阶段7: 测试、打包和发布回归 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 运行 npm test
Write-Host "[1/4] 运行单元测试..." -ForegroundColor Yellow
Push-Location (Join-Path $PSScriptRoot "..")
try {
    npm test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Tests failed!" -ForegroundColor Red
        $failed++
    } else {
        Write-Host "  All tests passed!" -ForegroundColor Green
    }
} finally {
    Pop-Location
}

Write-Host ""

# 2. node --check 各主要文件
Write-Host "[2/4] 语法检查..." -ForegroundColor Yellow
$files = @(
    "electron/main.js",
    "electron/view-manager.js",
    "electron/preload.js",
    "electron/settings-normalize.js",
    "src/js/renderer.js",
    "src/js/quick.js",
    "src/js/settings.js"
)

foreach ($file in $files) {
    $fullPath = Join-Path $PSScriptRoot ".." $file
    if (Test-Path $fullPath) {
        $result = node --check $fullPath 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  FAIL: $file" -ForegroundColor Red
            Write-Host "    $result" -ForegroundColor Gray
            $failed++
        } else {
            Write-Host "  OK: $file" -ForegroundColor Green
        }
    } else {
        Write-Host "  SKIP: $file (not found)" -ForegroundColor Yellow
    }
}

Write-Host ""

# 3. 打包验证 (portable)
Write-Host "[3/4] 打包验证 (portable)..." -ForegroundColor Yellow
Push-Location (Join-Path $PSScriptRoot "..")
try {
    npm run dist:portable
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Build failed!" -ForegroundColor Red
        $failed++
    } else {
        Write-Host "  Build succeeded!" -ForegroundColor Green
    }
} catch {
    Write-Host "  Build skipped or failed: $_" -ForegroundColor Yellow
} finally {
    Pop-Location
}

Write-Host ""

# 4. 总结
Write-Host "[4/4] 验证总结" -ForegroundColor Yellow
if ($failed -gt 0) {
    Write-Host "验证完成，有 $failed 项失败" -ForegroundColor Red
    exit 1
} else {
    Write-Host "所有验证通过！" -ForegroundColor Green
    exit 0
}
