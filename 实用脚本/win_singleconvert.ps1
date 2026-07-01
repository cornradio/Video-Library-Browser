param (
    [string]$Name = $(Read-Host "Enter video name keyword to search")
)

# ======================== Configuration ========================
$SRC_DIR = "\\192.168.31.11\Shared\localMV"
$HANDBRAKE = "$PSScriptRoot\HandBrakeCLI.exe"
$VIDEO_ENCODER = "nvenc_h265"
# ===============================================================

if (-not (Test-Path $HANDBRAKE)) {
    Write-Error "[ERROR] Cannot find HandBrakeCLI.exe"
    exit
}

if ([string]::IsNullOrEmpty($Name)) {
    Write-Warning "[WARN] Keyword cannot be empty!"
    exit
}

Write-Host "=================================================="
Write-Host "[SEARCH] Searching safely for keyword: $Name"
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
    Write-Host "[INFO] Multiple files found. Please choose one to convert:"
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

$dst_file = $base_path_no_ext + ".mp4"

# 原文件是 MP4 时，为了防止原位写入冲突，先输出为 .fixed.mp4 临时文件
$is_source_mp4 = $src_extension -eq ".mp4"
if ($is_source_mp4) {
    $dst_file = $base_path_no_ext + ".fixed.mp4"
}

Write-Host "=================================================="
Write-Host "[TARGET ] Selected: $($targetFile.Name)"
Write-Host "[OUTPUT ] Target  : $dst_file"
Write-Host "=================================================="

# 调用 HandBrakeCLI 进行万能兼容音频重构（彻底移除字幕抓取，只管音画）
Write-Host "[PROCESSING] Re-encoding video and force-fixing audio tracks..."
& $HANDBRAKE -i $src_full_path -o $dst_file `
  -e $VIDEO_ENCODER `
  -q 26 `
  --maxHeight 1080 --maxWidth 1920 `
  -r 30 --vfr `
  -a 1 `
  -E avc_aac `
  -B 128 `
  --mixdown stereo

# 检查结果并原子替换原文件
if ($LASTEXITCODE -eq 0 -and (Test-Path $dst_file) -and (Get-Item $dst_file).Length -gt 0) {
    Write-Host "=================================================="
    Write-Host "[FINISHED] Video transcode completed successfully!"
    
    if ($is_source_mp4) {
        Write-Host "[CLEANUP ] Source is MP4. Performing in-place swap..."
        Remove-Item $src_full_path -Force
        Rename-Item -Path $dst_file -NewName $targetFile.Name
        Write-Host "[CLEANUP ] In-place replacement completed!"
    }
    Write-Host "=================================================="
} else {
    Write-Host "[ERROR] Transcode failed!"
    if (Test-Path $dst_file) { Remove-Item $dst_file -Force }
}