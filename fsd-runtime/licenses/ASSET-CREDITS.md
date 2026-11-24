# 素材、作者与修改记录

| 随项目分发的内容 | 原作与许可 | 项目中的改动 |
| --- | --- | --- |
| Tesla Roadster | [Tesla Roadtser 2026 · asiphy007](https://sketchfab.com/3d-models/tesla-roadtser-2026-7630c9fe842d4f5ea86fc1f122753b89) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 统一比例，分离四轮，复用后轮几何修整前轮，设置轮心与悬挂节点，另有静态打印版。原始 ZIP 下载地址中的模型 ID 与作者页面一致。 |
| 2018 Model 3 | [Tesla 2018 Model 3 · Ameer Studio](https://sketchfab.com/3d-models/tesla-2018-model-3-5ef9b845aaf44203b6d04e2c677e444f) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 分组四轮、校准米制与轴心、接入方向盘及门盖交互。Performance 参数与模型外观分别标定。 |
| 2026 Model Y Performance | [BloxBloger](https://sketchfab.com/3d-models/2026-tesla-model-y-performance-8a0bc252f9da4015a02a7bd99efd4847) · [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | 分离滚动部件和固定卡钳、修整内轮拱、保留原贴图。**该素材仅限非商业用途。** |
| 城市交通 BMW X6M | [vecarz / heynic](https://sketchfab.com/3d-models/bmw-x6m-competition-assetto-wwwvecarzcom-3979a908081948e0971f5a5380b60a0f) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 沿用旧版 DriveScene 外观，分离四轮，新增车漆及三档显示精度。 |
| 城市环境 | [DriveScene Studio · Peixin](https://paxton0209.github.io/DriveScene-Studio/) · [历史版本](https://github.com/prajeeshmp86/DriveScene-Studio/tree/ba307215f5ce67289a9cacea8ae6fb54870d5307) · MIT 代码及 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 环境素材 | 采用该历史快照的烘焙环境、灯光与配色，在模拟器内生成道路、碰撞体与导航。许可快照随包保留。 |
| 沥青与草地 | Poly Haven · [Asphalt 02](https://polyhaven.com/a/asphalt_02) 和 [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) · [CC0](https://polyhaven.com/license) | 使用 1K 颜色、法线、粗糙度贴图。 |

## 本地轨迹模型

[Plan-R1 · Xiaolong Tang 等](https://github.com/XiaolongTang23/Plan-R1/tree/23bc54433599002f275c18b88cf261ab5e87d775) 的代码采用 Apache 2.0。项目提取了推理部分、增加游戏状态适配和路线引导解码，保留原始作者的检查点与动作词典。权重来自上游 README 链接，SHA-256 为 `c5f590b3ae2b1bda0a684f3a826289c8b4336a9ce7424fea18be3f1bce0b9259`。上游下载页未单列权重许可；其进一步使用条件需参考作者说明。

Windows 随包提供 CPython、CPU 版 PyTorch、PyTorch Geometric 与数值计算依赖。Python Software Foundation 许可、各包的许可文本和 Microsoft 运行库声明随对应文件分发。源码包含下载地址、版本与校验值。Three.js、Rapier 和 Electron 保留各自的上游许可。Tesla 名称、商标与设计归相关权利人。本项目独立开发，作者与品牌均未为模拟器背书。
