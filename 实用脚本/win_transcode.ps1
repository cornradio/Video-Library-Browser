param (
    [int]$n = 0
)

# ======================== 配置区域 ========================
# 服务器共享目录在 Windows 上的网络路径
$SRC_DIR = "\\192.168.31.11\Shared\localMV"

# 【核心修改】：直接读取当前脚本所在目录下的 HandBrakeCLI.exe
$HANDBRAKE = "$PSScriptRoot\HandBrakeCLI.exe"

# 自动转换备忘录日志路径（依旧保存在服务器上）
$HISTORY_LOG = "$SRC_DIR\autoconverted.log"

# 显卡加速选择 (NVIDIA 显卡用 nvenc_h265)
$VIDEO_ENCODER = "nvenc_h265"
# ==========================================================

if (-not (Test-Path $HANDBRAKE)) {
    Write-Error "[ERROR] Cannot find HandBrakeCLI.exe at: $HANDBRAKE"
    exit
}

if (-not (Test-Path $HISTORY_LOG)) {
    New-Item -Path $HISTORY_LOG -ItemType File -Force | Out-Null
}

Write-Host "=================================================="
Write-Host "[START] Windows Batch Transcoding Task"
Write-Host "[TARGET DIR]: $SRC_DIR"
if ($n -gt 0) {
    Write-Host "[LIMIT     ]: Only processing the first $n NEW video(s)"
} else {
    Write-Host "[LIMIT     ]: Processing ALL pending videos"
}
Write-Host "=================================================="

$counter = 0
$mkvFiles = Get-ChildItem -Path $SRC_DIR -Filter "*.mkv" -Recurse

foreach ($file in $mkvFiles) {
    if ($n -gt 0 -and $counter -ge $n) {
        Write-Host "[INFO] Reached the limit of $n video(s). Stopping."
        break
    }

    $relative_path = $file.FullName.Substring($SRC_DIR.Length + 1).Replace("\", "/")
    $dst_file = $file.FullName.Substring(0, $file.FullName.Length - 4) + ".mp4"

    # 1. 检查备忘录
    if (Select-String -Path $HISTORY_LOG -Pattern [regex]::Escape($relative_path) -Quiet) {
        Write-Host "[SKIP] Already recorded in history log: $relative_path"
        continue
    }

    # 2. 检查原地是否有转好的 mp4
    if (Test-Path $dst_file) {
        $dst_info = Get-Item $dst_file
        if ($dst_info.Length -gt 0) {
            Write-Host "[SKIP] MP4 already exists in place: $relative_path"
            Add-Content -Path $HISTORY_LOG -Value $relative_path
            continue
        }
    }

    Write-Host "[PROCESSING]: $relative_path"

    # 3. 调用 HandBrakeCLI
    & $HANDBRAKE -i $file.FullName -o $dst_file `
      -e $VIDEO_ENCODER `
      --maxHeight 1080 --maxWidth 1920 `
      -r 30 --vfr `
      --audio-lang-list cmn,chi,eng `
      --subtitle-lang-list chi,zho 

    if ($LASTEXITCODE -eq 0 -and (Test-Path $dst_file) -and (Get-Item $dst_file).Length -gt 0) {
        Write-Host "[FINISHED]: $relative_path"
        Add-Content -Path $HISTORY_LOG -Value $relative_path
        Write-Host "--------------------------------------------------"
        $counter++
    } else {
        Write-Host "[ERROR] Transcode FAILED for: $relative_path"
        if (Test-Path $dst_file) { Remove-Item $dst_file -Force }
        exit
    }
}

Write-Host "=================================================="
Write-Host "[SUCCESS] Windows Process completed!"
Write-Host "=================================================="