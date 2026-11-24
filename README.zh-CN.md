# Roadster Flight Lab

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md)

**在同一个离线驾驶模拟器里，把 Roadster 送上飞坡，给 Model 3 做坡起测试，或者坐进 Model Y，观察本地模型怎样在城市里选择车道。**

[下载 Windows x64 便携版](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Windows-x64.exe) · [下载 Apple Silicon Mac 版](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Mac-arm64.zip) · [所有发布文件与校验值](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.0)

![Tesla Garage 中可环绕查看的 Model 3 Performance](docs/images/garage.jpg)

**界面语言**　首次启动使用英语。在 Tesla Garage 左侧的 Language 下拉框中选择简体中文，应用会重新打开车库并记住选择。八种语言都可离线使用。

## 第一次上车

**Windows 11 Intel / AMD** 下载上面的 EXE，双击打开。便携启动器会先把游戏和本地推理环境解压到临时目录，请预留约 3 GB 空间。Windows 版未做 Authenticode 签名，SmartScreen 可能提示发布者未知。**Apple Silicon Mac** 下载 ZIP，解压后打开 App。Mac 版采用 Ad-hoc 签名，未经 Apple 公证。两个桌面包都自带车辆、贴图、物理引擎与模型，游戏时可断网。

| 想试什么 | 从车库出发 |
| --- | --- |
| 第一次飞跃 | 选 **Roadster → 开始驾驶 → 坡道试验区 → D5 长距大跳**。看纵剖面和建议车速，点「前往起点」。先用电驱跑一趟，再按 Shift 对比后喷助推。 |
| 比较底盘 | 先开 **Model 3 Performance** 上 A5 的 45% 坡，再换 **Model Y Performance** 走同一条线。观察入坡时的俯仰、轴荷变化和坡顶接地。 |
| 观察城市自动驾驶 | 选车后点 **进入 FSD 城市 → 地图选点**，点想去的位置并启用 FSD。蓝色轨迹从车头向前延伸。WASD 或空格可以随时接管。 |

## 三辆车，两种场地

| 车辆 | 在模拟器里可以体验 |
| --- | --- |
| Tesla Roadster | 四驱电机、10 个冷气喷嘴、自动补气、悬浮与空中姿态控制。实验设定下可以靠后喷跑直线，也可以关掉稳定辅助自己控制落地姿态。 |
| 2018 Model 3 Performance | 按当年 Performance 测试车标定的双电机 AWD、前后轴动力分配、再生制动，以及 Standard、Performance、Track 三种模式。450 hp 为历史实车测试参考。 |
| 2026 Model Y Performance | 独立的美国版 Performance 动力、车身与悬挂参数，保留 SUV 的坐姿和轮拱几何。适合与 Model 3 在相同制动、坡面及转弯条件下对照。 |

**实体试车场**有 20 条专用坡道。A 区测爬坡和坡起，B 区有波浪路与搓板路，C 区测试侧倾、反向扭转和交叉轴，D 区包含桌面跳台、连跳和断崖。可见坡面和碰撞面共用顶点。45% 坡表示水平前进 100 米时升高 45 米。

![Roadster 驶上长距大跳的起跳坡](docs/images/jump.jpg)

**FSD 城市**约有 61.43 公里道路中心线，包含市区街道、环城高速、辅路、匝道、隧道和掉头连接。地图选点后，导航寻找可达的道路。交通车会排队、让行并争用路口。本地 Plan-R1 根据车辆历史、路网和周围车流，每次生成未来 8 秒的 16 个姿态。控制层处理跟踪、交通间隙与制动，屏幕上的蓝线显示当前可见的预测路段。可在驾驶记录里对照模型输出与实际轨迹。这是游戏中的独立研究功能，与 Tesla 车载 FSD 无关。

![在市区路口观察车头前方的转弯轨迹](docs/images/city.jpg)

## 键盘操作

| 按键 | 操作 |
| --- | --- |
| W / S，A / D | 加速、制动或倒车，向左或向右转向 |
| 空格，C，R，Esc | 手刹、切换视角、重置车辆、打开车库 |
| Shift，J / K，H | Roadster 后喷、升降、悬浮 |
| 方向键，T | Roadster 空中姿态、飞行模式；Model 3 的 T 切换驾驶模式 |
| L | Model 3 车灯 |

## 怎样验证驾驶效果

Three.js 渲染车辆和场景，Rapier 以 **120 Hz** 固定步长推进刚体。三个控制器共用世界和地面，分别配置动力、轮胎、转向与悬挂。坡道验证让每辆车从静止起步，靠车辆控制器驶过全部 20 条车道，共 **60 趟**。另用 **1,788 次射线**检查渲染坡面和碰撞坡面，高度差均在 3 毫米容差内。Apple Silicon 桌面包另完成 A5 爬坡及 D5 离地后重新接地测试。[坡道测试与测量](reports/slope-park/驾驶验证.md)

Roadster 的历史模拟基准为纯电 0–100 km/h **3.502 s**，电驱加后喷为 **1.0411 s**。两项都是本项目的模拟成绩。Model 3 的资料按时间区分实车测试、厂方宣传和模拟器成绩，并分别记录是否扣除起步 rollout。[Model 3 动力报告](reports/model3-physics-report.md) · [Model Y 动力报告](reports/model-y-physics-report.md)

## 从源码运行

需要 Node.js 22.12 或更高兼容版本及 npm。仓库直接提供原始车辆、可驾驶 GLB、道路贴图、交通车、动作词典和 Plan-R1 检查点。首次安装开发依赖需要联网。

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

打开终端显示的本地地址可手动驾驶。要在开发版启用城市模型，或构建内含模型的桌面包，先准备对应系统的运行环境。

| 平台 | 准备与打包 |
| --- | --- |
| Windows x64 | 安装 Python 3.10+，运行 `python scripts/fsd/prepare_windows_runtime.py`。脚本校验 33 个固定下载文件并组装独立运行环境。运行 `node scripts/fsd/smoke_portable.cjs` 可验证一次真实推理，再运行 `npm run pack:win`。 |
| macOS Apple Silicon | 准备 Xcode 命令行工具、Python 与 uv，运行 `python3 scripts/fsd/bootstrap.py`，再运行 `npm run pack:mac`。签名及验证由打包脚本完成。 |

产物位于 `desktop-build/`。开发桌面入口为 `npm run build` 后执行 `npm run desktop`。Windows 验证流程可从源码构建，也可下载一个指定 Release 的 EXE，直接对其内置模型、车库、车辆切换和城市进出做检查。[Windows 验证流程](.github/workflows/windows.yml)

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

| 目录 | 内容 |
| --- | --- |
| `src/vehicles`、`src/vehicle`、`src/thrusters` | 车型配置、底盘与推进器 |
| `src/world`、`src/fsd` | 场地、路网、交通、路线、模型适配与轨迹显示 |
| `assets/originals`、`public/models`、`public/textures` | 原始素材、可驾驶模型、交通车和离线贴图 |
| `desktop`、`fsd-runtime`、`scripts/fsd` | 桌面入口、推理代码与权重、各平台运行环境准备脚本 |
| `print` | Roadster 1:24 静态打印版 3MF、生成脚本和切片说明 |

## 素材署名

感谢 asiphy007、Ameer Studio、BloxBloger、vecarz / heynic、Peixin、Poly Haven 和 Plan-R1 作者。各素材沿用各自条款，其中 **Model Y 素材为 CC BY-NC 4.0，仅限非商业使用**。仓库收录上游原始权重，并保留其许可说明的边界。[完整署名、原作链接与修改记录](CREDITS.md)

原车轮处理也可独立复现。使用 Python 3.12、NumPy 2.3.5、SciPy 1.18.1 和 manifold3d 3.5.4，运行下列命令会生成一份新文件。

```sh
python scripts/roadster-mesh-process.py --input "assets/originals/tesla roadtser 2026.glb" --output rebuilt/roadster.glb --report rebuilt/wheels.json
```
