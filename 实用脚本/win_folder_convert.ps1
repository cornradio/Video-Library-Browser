param (
    [string]$FolderName = $(Read-Host "Enter FOLDER name keyword to search")
)
# 先去生成fixed.mp4 ,然后直接删除并替换原来的？

# ======================== Configuration ========================
$SRC_DIR = "\\192.168.31.11\Shared\localMV"
$HANDBRAKE = "$PSScriptRoot\HandBrakeCLI.exe"
$VIDEO_ENCODER = "nvenc_h265"
# ===============================================================

if (-not (Test-Path $HANDBRAKE)) {
    Write-Error "[ERROR] Cannot find HandBrakeCLI.exe"
    exit
}

if ([string]::IsNullOrEmpty($FolderName)) {
    Write-Warning "[WARN] Folder keyword cannot be empty!"
    exit
}

Write-Host "=================================================="
Write-Host "[SEARCH] Searching safely for FOLDER keyword: $FolderName"
Write-Host "=================================================="

# 递归找出所有匹配关键字的【文件夹】
$allDirs = Get-ChildItem -Path $SRC_DIR -Recurse -Directory
$foundDirs = @()

foreach ($dir in $allDirs) {
    if ($dir.Name.ToLower().Contains($FolderName.ToLower())) {
        $foundDirs += $dir
    }
}

if ($foundDirs.Count -eq 0) {
    Write-Warning "[WARN] No matching folders found for keyword: '$FolderName'"
    exit
}

# 匹配到多个文件夹时提供交互菜单
$targetDir = $null
if ($foundDirs.Count -gt 1) {
    Write-Host "[INFO] Multiple folders found. Please choose one to process:"
    for ($i = 0; $i -lt $foundDirs.Count; $i++) {
        $displayPath = $foundDirs[$i].FullName.Substring($SRC_DIR.Length + 1)
        Write-Host "  [$i] $displayPath"
    }
    Write-Host "=================================================="
    $choice = Read-Host "Enter folder index number [0-$($foundDirs.Count - 1)]"
    if ($choice -match '^\d+$' -and [int]$choice -lt $foundDirs.Count) {
        $targetDir = $foundDirs[[int]$choice]
    } else {
        Write-Error "[ERROR] Invalid choice. Exiting."
        exit
    }
} else {
    $targetDir = $foundDirs[0]
}

Write-Host "=================================================="
Write-Host "[TARGET FOLDER]: $($targetDir.FullName)"
Write-Host "=================================================="

# 扫描选定文件夹下的所有 mkv 和 mp4 视频
$videos = Get-ChildItem -Path $targetDir.FullName -Include "*.mkv", "*.mp4" -Recurse

if ($videos.Count -eq 0) {
    Write-Warning "[WARN] No mkv or mp4 videos found in this folder."
    exit
}

Write-Host "[INFO] Found $($videos.Count) video(s) to process. Starting batch..."
Write-Host "=================================================="

foreach ($file in $videos) {
    $src_full_path = $file.FullName
    $src_extension = $file.Extension
    $base_path_no_ext = $src_full_path.Substring(0, $src_full_path.Length - $src_extension.Length)
    
    $dst_file = $base_path_no_ext + ".mp4"
    $is_source_mp4 = $src_extension -eq ".mp4"
    
    if ($is_source_mp4) {
        $dst_file = $base_path_no_ext + ".fixed.mp4"
    }

    Write-Host "[PROCESSING]: $($file.Name)"
    
    # 调用万能修复音频参数 (修复在线无声)
    & $HANDBRAKE -i $src_full_path -o $dst_file `
      -e $VIDEO_ENCODER `
      --maxHeight 1080 --maxWidth 1920 `
      -r 30 --vfr `
      -a 1 `
      -E avc_aac `
      -B 160 `
      --mixdown stereo

    # 检查转码结果并原子替换
    if ($LASTEXITCODE -eq 0 -and (Test-Path $dst_file) -and (Get-Item $dst_file).Length -gt 0) {
        if ($is_source_mp4) {
            Remove-Item $src_full_path -Force
            Rename-Item -Path $dst_file -NewName $file.Name
        }
        Write-Host "[SUCCESS] Done: $($file.Name)"
    } else {
        Write-Host "[ERROR] Failed to process: $($file.Name)"
        if (Test-Path $dst_file) { Remove-Item $dst_file -Force }
    }
    Write-Host "--------------------------------------------------"
}

Write-Host "=================================================="
Write-Host "[ALL DONE] Folder batch transcoding completed!"
Write-Host "=================================================="