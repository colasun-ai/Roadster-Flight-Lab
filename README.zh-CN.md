# Roadster Flight Lab

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md)

**在同一个试车场，把 Roadster 送上飞坡，开 Model 3 驶过倾斜弯道比较悬挂反应，再坐进 Model Y，观察本地规划模型怎样在城市里选择车道。**

[下载适用于 Windows x64 的版本](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Windows-x64.exe) · [下载 Apple Silicon](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Mac-arm64.zip) · [发行说明和校验和](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.0)

![特斯拉车库展示 2018 年款 Model 3 Performance](docs/images/garage.jpg)

## 你的第一次驾驶

在 Tesla Garage 中选择 Roadster，选择开始驾驶，然后打开斜坡公园并选择 D5。检查坡道轮廓，跳至起点并尝试使用电力运行。按住 Shift 键向后推力，重复此操作。

**语言** · 英语是初始语言。在 Tesla Garage 中选择一种语言，以根据您的选择重新打开车库。该应用程序会在会话之间记住它。菜单、仪器、课程描述和导航提示可离线使用。

## 在车库里

| 车辆 | 要尝试什么 |
| --- | --- |
| Tesla Roadster | 使用十个冷气喷嘴进行助推、悬停、滚转和着陆。在稳定、手动和混沌飞行之间切换。机载压缩机不断地补充水箱。 |
| 2018 Model 3 Performance | 比较标准、性能和赛道模式。双电机全轮驱动模型融合了再生制动和摩擦制动。 450 马力的参考值来自一段时期的道路测试。 |
| 2026 Model Y Performance | 凭借自己的动力输出、底盘和阻尼来驱动美国市场的高性能 SUV。采取与 Model 3 相同的拐角或山坡来比较车身运动。 |

## 测试悬架的二十种方法

斜坡公园有四个区域：坡度为 8-45% 的山坡、坡顶和坡地、倾斜和交叉轴部分以及不同着陆点的跳跃。渲染器和物理引擎使用相同的表面顶点。 45% 的坡度在 100 m 的水平距离上上升 45 m。

![Roadster 接近 D5 跳远](docs/images/jump.jpg)

## 跟随当地规划师游览城市

在地图上选择一个目的地并与 FSD 交战。 61.43公里的路网包括高速公路、便道、坡道、隧道和掉头连接。 Plan-R1 预测 8 秒内的 16 个姿势。控制器遵循选定的轨迹并应用交通和制动保护措施。蓝丝带显示了平面图的近部分。使用 WASD 或空格键随时接管。

![城市转弯，车辆前方可见规划路径](docs/images/city.jpg)

## 键盘控制

| 钥匙 | 行动 |
| --- | --- |
| W / S · A / D | 加速、刹车或倒车；向左或向右转向 |
| Space | 手刹；以城市模式接管 |
| C · R · Esc | 循环相机；重置汽车；打开车库 |
| Shift · J / K · H | 后助力；垂直喷射；切换悬停 |
| T | 更改 Roadster 上的飞行模式或 Model 3 上的驾驶模式 |

## 桌面下载

在具有 Intel 或 AMD CPU 的 Windows 11 上，双击可移植 EXE。允许大约 3 GB 的临时空间用于提取。该可执行文件未签名，因此 Windows 可能会显示未知发布者提示。

在 Apple Silicon Mac 上，解压 ZIP 并打开应用程序。它有一个临时签名，并且未经 Apple 公证。两个桌面包都包括车辆、纹理、物理引擎和 CPU 规划器。

## 测量了什么

剑杆以固定的 120 Hz 运行。三辆车中的每辆车都完成了物理回归中的全部二十个课程，运行了六十次。在 1,788 个射线样本中，碰撞和可见斜面高度一致在 3 毫米以内。早期的 Roadster 模拟器测试记录了电动 0-100 公里/小时发射时间为 3.502 秒，喷气辅助发射时间为 1.0411 秒。这些是模拟器结果。 [斜率验证数据](reports/slope-park/驾驶验证.md)

## 从源代码构建

将 Node.js 22.12 或更高版本与 npm 一起使用。该存储库包括原始模型、可驾驶的网格、纹理、动作词汇和 Plan-R1 检查点。第一个依赖项安装需要互联网访问。

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

Windows x64：使用Python 3.10或更高版本准备嵌入式运行时，验证真实推理，然后创建可移植的EXE。

```sh
python scripts/fsd/prepare_windows_runtime.py
node scripts/fsd/smoke_portable.cjs
npm run pack:win
```

Apple Silicon：在准备运行时和构建签名应用程序之前安装 Xcode 命令行工具和 uv。

```sh
python3 scripts/fsd/bootstrap.py
npm run pack:mac
```

### 运行回归套件

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

桌面包写入desktop-build目录。打印目录包含 1:24 Roadster 3MF 及其重建脚本。

## 积分和许可

由asiphy007、Ameer Studio、BloxBloger 和vecarz / heynic 制作的车辆模型。该城市采用了 Peixin 历史悠久的 DriveScene Studio 环境，并使用 Poly Haven 地面纹理。当地规划以唐晓龙及其同事的 Plan-R1 为基础。 Model Y 资产为 CC BY-NC 4.0，仅限于非商业用途。上游检查站没有单独规定的许可证。 Roadster Flight Lab 是一个独立的模拟器。 [原始资产、许可和修改](CREDITS.md)
