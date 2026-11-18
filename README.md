# NEXO — Enterprise Demand & Supply Chain Planning

تطبيق سطح مكتب متكامل لتخطيط الطلب وإدارة المخزون وسلاسل الإمداد (Windows Desktop App) مدعوم بمحرك **WebView2** وقاعدة بيانات **DuckDB** مع ربط مباشر مع **Microsoft SQL Server ERP** وملفات **Excel**.

---

## 🚀 طرق التنزيل والتثبيت السريع (Installation)

### 1. التثبيت بضغطة واحدة عبر PowerShell (يعمل حتى بدون وجود Git على الجهاز)
افتح نافذة **PowerShell** والصق الأمر التالي وسيقوم بتنزيل التطبيق في مجلد المستخدم وتثبيت كافة المكتبات وإنشاء أيقونة سطح المكتب تلقائياً:
```powershell
$dest = "$env:USERPROFILE\NEXO"; New-Item -ItemType Directory -Force -Path $dest | Out-Null; Invoke-WebRequest -Uri "https://github.com/Ramisharafaldin/NEXO-Enterprise-Desktop-App/archive/refs/heads/main.zip" -OutFile "$dest\nexo.zip"; Expand-Archive -Path "$dest\nexo.zip" -DestinationPath $dest -Force; Copy-Item "$dest\NEXO-Enterprise-Desktop-App-main\*" -Destination $dest -Recurse -Force; Remove-Item "$dest\NEXO-Enterprise-Desktop-App-main","$dest\nexo.zip" -Recurse -Force; Set-Location $dest; .\setup.bat
```

### 2. التثبيت عبر موجه الأوامر (CMD)
افتح شاشة **CMD** والصق الأمر التالي:
```cmd
mkdir "%USERPROFILE%\NEXO" 2>nul & cd /d "%USERPROFILE%\NEXO" & curl -L "https://github.com/Ramisharafaldin/NEXO-Enterprise-Desktop-App/archive/refs/heads/main.zip" -o nexo.zip & tar -xf nexo.zip --strip-components=1 & del nexo.zip & setup.bat
```

### 3. التثبيت للمطورين عبر Git Clone
```bash
git clone https://github.com/Ramisharafaldin/NEXO-Enterprise-Desktop-App.git
cd NEXO-Enterprise-Desktop-App
.\setup.bat
```

---

## 🔄 التحديث التلقائي (OTA Auto-Updater)
- **من داخل التطبيق:** بمجرد رفع أي تحديث جديد على GitHub، يظهر شريط إشعار أعلى واجهة **NEXO**؛ اضغط على **تحديث الآن وإعادة التشغيل** ليتم سحب التحديث وبناء النسخة الجديدة وإعادة التشغيل تلقائياً مع الحفاظ الكامل على قاعدة بياناتك (
exo_workspace.duckdb).
- **يدوياً عبر الترمنال:**
```powershell
git pull
npm run build
```
