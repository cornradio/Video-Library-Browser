param (
    [string]$Name = $(Read-Host "Enter video name keyword to search")
)

# ======================== Configuration ========================
$SRC_DIR = "\\192.168.31.11\Shared\localMV"
$FFMPEG = "ffmpeg"  # 确保你系统环境变量里有 ffmpeg，或者改成绝对路径
# ===============================================================

if ([string]::IsNullOrEmpty($Name)) { Write-Warning "[WARN] Keyword empty!"; exit }

Write-Host "=================================================="
Write-Host "[SEARCH] Searching for video: $Name"
Write-Host "=================================================="

# 1. 搜视频 (只找 MP4)
$allFiles = Get-ChildItem -Path $SRC_DIR -Recurse -File
$videos = @()
foreach ($f in $allFiles) {
    if ($f.Extension -eq ".mp4" -and $f.Name.ToLower().Contains($Name.ToLower())) {
        $videos += $f
    }
}

if ($videos.Count -eq 0) { Write-Warning "[WARN] No MP4 found."; exit }

# 2. 交互选择
$targetVideo = $null
if ($videos.Count -gt 1) {
    Write-Host "[INFO] Multiple videos found. Choose one:"
    for ($i = 0; $i -lt $videos.Count; $i++) {
        Write-Host "  [$i] $($videos[$i].FullName.Substring($SRC_DIR.Length + 1))"
    }
    $choice = Read-Host "Enter index [0-$($videos.Count - 1)]"
    if ($choice -match '^\d+$' -and [int]$choice -lt $videos.Count) { $targetVideo = $videos[[int]$choice] } else { exit }
} else { $targetVideo = $videos[0] }

# 3. 寻找同级同名的字幕文件 (.srt 或 .ass 或 .zh.srt)
$vDir = $targetVideo.DirectoryName
$vNameNoExt = [System.IO.Path]::GetFileNameWithoutExtension($targetVideo.Name)

# 支持常见后缀：.srt, .ass, .zh.srt
$subFile = Get-ChildItem -Path $vDir -Filter "$vNameNoExt*" | Where-Object { $_.Extension -in ".srt", ".ass" } | Select-Object -First 1

if (-not $subFile) {
    Write-Error "[ERROR] No matching subtitle file (.srt/.ass) found in the same folder!"
    exit
}

Write-Host "=================================================="
Write-Host "[VIDEO]: $($targetVideo.Name)"
Write-Host "[SUBTITLE]: $($subFile.Name)"
Write-Host "=================================================="

$tmp_output = Join-Path $vDir "$vNameNoExt.subbed.mp4"

# 4. FFmpeg 极速混流 (1秒搞定)
& $FFMPEG -y -i $targetVideo.FullName -i $subFile.FullName `
  -c copy -c:s mov_text `
  -metadata:s:s:0 language=chi -metadata:s:s:0 title="Chs" `
  $tmp_output

# 5. 安全原子替换
if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp_output) -and (Get-Item $tmp_output).Length -gt 0) {
    Remove-Item $targetVideo.FullName -Force
    Rename-Item -Path $tmp_output -NewName $targetVideo.Name
    Write-Host "[SUCCESS] Subtitle merged successfully in 1 second!"
} else {
    Write-Error "[ERROR] Merge failed."
    if (Test-Path $tmp_output) { Remove-Item $tmp_output -Force }
}