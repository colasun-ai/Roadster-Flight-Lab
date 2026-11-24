# Roadster Flight Lab

[English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md)

**在同一座試車場開 Roadster 飛越跳台、駕駛 Model 3 通過傾斜彎道感受懸吊反應，再坐進 Model Y，看看本機規劃模型如何在市區選擇車道。**

[下載適用於 Windows x64 的版本](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Windows-x64.exe) · [下載 Apple Silicon](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Mac-arm64.zip) · [發行說明和校驗和](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.0)

![特斯拉車庫展示 2018 年 Model 3 Performance](docs/images/garage.jpg)

## 你的第一次駕駛

在 Tesla Garage 中選擇 Roadster，選擇開始駕駛，然後打開斜坡公園並選擇 D5。檢查坡道輪廓，跳至起點並嘗試使用電力運行。按住 Shift 鍵向後推力，重複此動作。

**語言** · 英語是初始語言。在 Tesla Garage 中選擇一種語言，以根據您的選擇重新開啟車庫。該應用程式會在會話之間記住它。選單、儀器、課程描述和導航提示可離線使用。

## 在車庫裡

| 車輛 | 要嘗試什麼 |
| --- | --- |
| Tesla Roadster | 使用十個冷氣噴嘴進行助推、懸停、滾轉和著陸。在穩定、手動和混沌飛行之間切換。機載壓縮機不斷地補充水箱。 |
| 2018 Model 3 Performance | 比較標準、性能和賽道模式。雙馬達全輪驅動車型融合了再生煞車和摩擦煞車。 450 馬力的參考值來自一段時期的道路測試。 |
| 2026 Model Y Performance | 憑藉自己的動力輸出、底盤和阻尼來驅動美國市場的高性能 SUV。採取與 Model 3 相同的角落或山坡來比較車身運動。 |

## 測試懸吊的二十種方法

斜坡公園有四個區域：坡度為 8-45% 的山坡、坡頂和坡地、傾斜和交叉軸部分以及不同著陸點的跳躍。渲染器和物理引擎使用相同的表面頂點。 45% 的坡度在 100 m 的水平距離上上升 45 m。

![Roadster 接近 D5 跳遠](docs/images/jump.jpg)

## 跟隨當地規劃師遊覽城市

在地圖上選擇一個目的地並與 FSD 交戰。 61.43公里的路網包括高速公路、便道、坡道、隧道和掉頭連接。 Plan-R1 預測 8 秒內的 16 個姿勢。控制器遵循選定的軌跡並應用交通和煞車保護措施。藍色絲帶顯示了平面圖的近部分。使用 WASD 或空白鍵隨時接管。

![城市轉彎，車輛前方可見規劃路徑](docs/images/city.jpg)

## 鍵盤控制

| 鑰匙 | 行動 |
| --- | --- |
| W / S · A / D | 加速、煞車或倒車；向左或向右轉向 |
| Space | 手煞車；以城市模式接管 |
| C · R · Esc | 循環相機；重置汽車；打開車庫 |
| Shift · J / K · H | 後助力；垂直噴射；切換懸停 |
| T | 變更 Roadster 上的飛航模式或 Model 3 上的駕駛模式 |

## 桌面下載

在具有 Intel 或 AMD CPU 的 Windows 11 上，雙擊可移植 EXE。允許大約 3 GB 的臨時空間用於提取。該可執行檔未簽名，因此 Windows 可能會顯示未知發布者提示。

在 Apple Silicon Mac 上，解壓縮 ZIP 並開啟應用程式。它有一個臨時簽名，並且未經 Apple 公證。兩個桌麵包都包括車輛、紋理、實體引擎和 CPU 規劃器。

## 測量了什麼

劍桿以固定的 120 Hz 運作。三輛車中的每輛車都完成了物理回歸中的全部二十個課程，運行了六十次。在 1,788 個射線樣本中，碰撞和可見斜面高度一致在 3 毫米以內。早期的 Roadster 模擬器測試記錄了電動 0-100 公里/小時發射時間為 3.502 秒，噴射輔助發射時間為 1.0411 秒。這些是模擬器結果。 [斜率驗證數據](reports/slope-park/驾驶验证.md)

## 從原始碼構建

將 Node.js 22.12 或更高版本與 npm 一起使用。此儲存庫包括原始模型、可駕駛的網格、紋理、動作詞彙和 Plan-R1 檢查點。第一個依賴項安裝需要網路存取。

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

Windows x64：使用Python 3.10或更高版本準備嵌入式執行時，驗證真實推理，然後建立可移植的EXE。

```sh
python scripts/fsd/prepare_windows_runtime.py
node scripts/fsd/smoke_portable.cjs
npm run pack:win
```

Apple Silicon：在準備運行時和建立簽名應用程式之前安裝 Xcode 命令列工具和 uv。

```sh
python3 scripts/fsd/bootstrap.py
npm run pack:mac
```

### 運行回歸套件

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

桌麵包寫入desktop-build目錄。列印目錄包含 1:24 Roadster 3MF 及其重建腳本。

## 積分和許可

由asiphy007、Ameer Studio、BloxBloger 和vecarz / heynic 制作的车辆模型。该城市采用了 Peixin 历史悠久的 DriveScene Studio 环境，并使用 Poly Haven 地面纹理。当地规划以唐晓龙及其同事的 Plan-R1 为基础。 Model Y 资产为 CC BY-NC 4.0，仅限于非商业用途。上游檢查站沒有單獨規定的許可證。 Roadster Flight Lab 是一个独立的模拟器。 [原始資產、許可和修改](CREDITS.md)
