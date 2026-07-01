param (
    [string]$Name = $(Read-Host "Enter video name keyword to EXTRACT subtitle")
)

# ======================== Configuration ========================
# Server shared directory network path
$SRC_DIR = "\\192.168.31.11\Shared\localMV"

# Tools path (located in the script folder)
$FFMPEG = "C:\bin\ffmpeg.exe"
# ===============================================================

if (-not (Test-Path $FFMPEG)) {
    Write-Error "[ERROR] Cannot find ffmpeg.exe in the script folder!"
    exit
}

if ([string]::IsNullOrEmpty($Name)) {
    Write-Warning "[WARN] Keyword cannot be empty!"
    exit
}

Write-Host "=================================================="
Write-Host "[SEARCH] Searching safely for subtitle source: $Name"
Write-Host "=================================================="

# 递归列出所有文件进行纯文本匹配
$allFiles = Get-ChildItem -Path $SRC_DIR -Recurse -File
$foundFiles = @()

foreach ($file in $allFiles) {
    if ($file.Name.ToLower().Contains($Name.ToLower()) -and ($file.Extension -eq ".mkv" -or $file.Extension -eq ".mp4")) {
        $foundFiles += $file
    }
}

if ($foundFiles.Count -eq 0) {
    Write-Warning "[WARN] No matching files found for keyword: '$Name'"
    exit
}

# 匹配到多个文件时提供交互菜单
$targetFile = $null
if ($foundFiles.Count -gt 1) {
    Write-Host "[INFO] Multiple files found. Please choose one:"
    for ($i = 0; $i -lt $foundFiles.Count; $i++) {
        $displayPath = $foundFiles[$i].FullName.Substring($SRC_DIR.Length + 1)
        Write-Host "  [$i] $displayPath"
    }
    Write-Host "=================================================="
    $choice = Read-Host "Enter index number [0-$($foundFiles.Count - 1)]"
    if ($choice -match '^\d+$' -and [int]$choice -lt $foundFiles.Count) {
        $targetFile = $foundFiles[[int]$choice]
    } else {
        Write-Error "[ERROR] Invalid choice. Exiting."
        exit
    }
} else {
    $targetFile = $foundFiles[0]
}

# 路径计算
$src_full_path = $targetFile.FullName
$src_extension = $targetFile.Extension
$base_path_no_ext = $src_full_path.Substring(0, $src_full_path.Length - $src_extension.Length)

# 默认先提取为通用性最好的 srt 软字幕
$dst_srt = $base_path_no_ext + ".zh.srt"

Write-Host "=================================================="
Write-Host "[TARGET ] Selected: $($targetFile.Name)"
Write-Host "[OUTPUT ] Subtitle: $dst_srt"
Write-Host "=================================================="

Write-Host "[EXTRACTING] Running FFmpeg stream extraction..."

# 执行 FFmpeg 无损抽取第一轨软字幕 (? 号代表如果没有软字幕流也不报错卡死)
# 2>$null 用来屏蔽 ffmpeg 密密麻麻的流媒体日志，保持控制台干净
& $FFMPEG -y -i $src_full_path -map s:0? "$dst_srt" 2>$null

# 检查结果
if ((Test-Path $dst_srt) -and (Get-Item $dst_srt).Length -gt 0) {
    Write-Host "=================================================="
    Write-Host "[FINISHED] Subtitle extracted successfully!"
    Write-Host "[LOCATION] Located next to your video file."
    Write-Host "=================================================="
} else {
    # 如果抽出来是个 0 KB 的空文件，说明原视频根本就没有内嵌软字幕轨
    if (Test-Path $dst_srt) { Remove-Item $dst_srt -Force }
    Write-Host "=================================================="
    Write-Host "[FAILED] Extraction failed! No embedded text subtitles found in this file."
    Write-Host "=================================================="
}