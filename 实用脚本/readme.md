没问题，直接上大白话最强精简版！

---

### 📂 4个脚本干啥的？怎么用？

#### 1️⃣ `win_transcode.ps1` — **全盘自动刷片机**

* **一句话功能**：把服务器里所有的 `.mkv` 视频**一网打尽**，自动转成有声音、有外挂字幕的 `.mp4`。
* **怎么运行**：
```powershell
.\win_transcode.ps1

```



#### 2️⃣ `win_folder_convert.ps1` — **整季/文件夹连播修复**

* **一句话功能**：搜出指定文件夹，把里面第 1 集到最后一集**自动排队**修复声音，MP4 格式会自动安全替换。
* **怎么运行**（推荐直接带名字）：
```powershell
.\win_folder_convert.ps1 -FolderName "洛基"

```



#### 3️⃣ `win_singleconvert.ps1` — **单集无声绝杀器**

* **一句话功能**：网页在线看发现某一集没声音？用它精准搜出来，**只修复这一集的声音**，也是安全原地替换。
* **怎么运行**：
```powershell
.\win_singleconvert.ps1 -Name "Ishuzoku"

```



#### 4️⃣ `win_single_extract_sub.ps1` — **单集字幕秒抽器**

* **一句话功能**：不碰视频和声音，**纯粹把字幕扒出来**变成 `.srt` 躺在视频旁边，0.5 秒搞定。
* **怎么运行**：
```powershell
.\win_single_extract_sub.ps1 -Name "Konosuba"

```



---

### ⚠️ 遇到问题看这里

* **体积变大了？** 打开转换脚本，在 HandBrake 参数里加上 `-q 26`（数字越大，体积越小）。
* **有 `.fuse_hidden` 删不掉？** 重启服务器（`sudo reboot`）就会自动蒸发。